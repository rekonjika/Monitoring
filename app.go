// app.go
package main

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	mqtt "github.com/eclipse/paho.mqtt.golang"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

type EspPayload struct {
	V int   `json:"v"`
	R int64 `json:"r"`
	C int   `json:"c"`
}

type NodeUpdate struct {
	Station         int    `json:"station"`
	NodeName        string `json:"node_name"`
	State           int    `json:"state"`
	Connected       bool   `json:"connected"`
	Rssi            int64  `json:"rssi"`
	AlarmCount      int    `json:"alarm_count"`      // Счетчик тревог узла
	DisconnectCount int    `json:"disconnect_count"` // Счетчик потерь связи узла
}

type App struct {
	ctx        context.Context
	mqttClient mqtt.Client
	db         *DBManager
	cfg        *Config
}

func NewApp() *App {
	return &App{}
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx

	cfg, err := LoadConfig("config.json")
	if err != nil {
		fmt.Printf("Ошибка конфигурации: %v\n", err)
		a.cfg = GetDefaultConfig()
	} else {
		a.cfg = cfg
		fmt.Println("✅ Файл настроек config.json загружен!")
	}

	dbManager, err := NewDBManager("monitoring.db")
	if err != nil {
		fmt.Printf("Ошибка БД: %v\n", err)
		return
	}
	err = dbManager.InitDatabase()
	if err != nil {
		fmt.Printf("Ошибка инициализации БД: %v\n", err)
		return
	}
	a.db = dbManager
	fmt.Println("✅ SQLite инициализирована!")

	a.initMQTT()
}

func (a *App) initMQTT() {
	brokerAddress := fmt.Sprintf("tcp://%s:%d", a.cfg.MqttBroker, a.cfg.MqttPort)
	opts := mqtt.NewClientOptions().AddBroker(brokerAddress)
	opts.SetClientID("Wails_Monitor_Core")
	opts.OnConnect = a.onMQTTConnect

	a.mqttClient = mqtt.NewClient(opts)
	if token := a.mqttClient.Connect(); token.Wait() && token.Error() != nil {
		fmt.Printf("❌ Ошибка MQTT: %v\n", token.Error())
	}
}

func (a *App) onMQTTConnect(client mqtt.Client) {
	fmt.Println("✅ Успешное подключение к Mosquitto!")
	client.Subscribe("station/+/node/+", 1, a.onMessageReceived)
}

func (a *App) onMessageReceived(client mqtt.Client, msg mqtt.Message) {
	topic := msg.Topic()
	payload := msg.Payload()

	// 🔍 ДОБАВЬТЕ ЭТУ СТРОКУ ПЕРВОЙ, ЧТОБЫ ВИДЕТЬ ВСЕ СЕТЕВЫЕ ПАКЕТЫ:
	fmt.Printf("📥 СЕТЕВОЙ ПАКЕТ: топик [%s], данные [%s]\n", topic, string(payload))

	parts := strings.Split(topic, "/")
	if len(parts) < 4 {
		return
	}

	station, _ := strconv.Atoi(parts[1])
	nodeID, _ := strconv.Atoi(parts[3])

	nodeIDStr := strconv.Itoa(nodeID)
	nodeName := a.cfg.NodeNames[nodeIDStr]
	if nodeName == "" {
		nodeName = fmt.Sprintf("Узел_%d", nodeID)
	}

	var espData EspPayload
	err := json.Unmarshal(payload, &espData)
	if err != nil {
		return
	}

	// 1. Запись события в SQLite
	stationStr := fmt.Sprintf("Станок %d", station)
	if a.db != nil {
		var eventType string
		if espData.C == 503 {
			eventType = "disconnect"
		} else if espData.V == 1 {
			eventType = "alarm"
			a.sendTelegramNotification(fmt.Sprintf("🔴 ТРЕВОГА!\nСтанок %d — %s", station, nodeName))
		} else {
			eventType = "normal"
		}

		a.db.LogEvent(stationStr, nodeName, eventType, strconv.Itoa(espData.V), fmt.Sprintf("RSSI: %d", espData.R))
	}

	// 2. Считываем обновленную из БД статистику для отправки в React!
	alarms, disconnects, _ := a.db.GetNodeStats(stationStr, nodeName)

	update := NodeUpdate{
		Station:         station,
		NodeName:        nodeName,
		State:           espData.V,
		Connected:       espData.C != 503,
		Rssi:            espData.R,
		AlarmCount:      alarms,
		DisconnectCount: disconnects,
	}

	runtime.EventsEmit(a.ctx, "node-update", update)
}

func (a *App) sendTelegramNotification(message string) {
	if !a.cfg.TelegramEnabled {
		return
	}
	go func() {
		apiURL := fmt.Sprintf("https://api.telegram.org/bot%s/sendMessage", a.cfg.TelegramBotToken)
		data := url.Values{}
		data.Set("chat_id", a.cfg.TelegramChatId)
		data.Set("text", message)

		client := &http.Client{Timeout: 5 * time.Second}
		resp, err := client.PostForm(apiURL, data)
		if err != nil {
			return
		}
		defer resp.Body.Close()
	}()
}

func (a *App) AcknowledgeAlarm(station int, nodeName string) {
	stationStr := fmt.Sprintf("Станок %d", station)
	if a.db != nil {
		a.db.LogEvent(stationStr, nodeName, "acknowledge", "0", "Оператор подтвердил тревогу")
	}
	a.sendTelegramNotification(fmt.Sprintf("✅ ТРЕВОГА ПРИНЯТА оператором\nСтанок %d — %s", station, nodeName))

	runtime.EventsEmit(a.ctx, "alarm-acknowledged", map[string]interface{}{
		"station":   station,
		"node_name": nodeName,
	})
}

func (a *App) ExportReport() string {
	if a.db == nil {
		return "Ошибка: БД не инициализирована"
	}
	filePath, err := runtime.SaveFileDialog(a.ctx, runtime.SaveDialogOptions{
		Title:           "Сохранить отчет в Excel",
		DefaultFilename: "Отчет_мониторинга.xlsx",
		Filters:         []runtime.FileFilter{{DisplayName: "Excel Files (*.xlsx)", Pattern: "*.xlsx"}},
	})
	if err != nil || filePath == "" {
		return "Экспорт отменен"
	}

	err = ExportToExcel(filePath, a.db)
	if err != nil {
		return fmt.Sprintf("Ошибка генерации: %v", err)
	}
	return fmt.Sprintf("✅ Отчет сохранен:\n%s", filePath)
}

// GetConfig возвращает текущие настройки для React
func (a *App) GetConfig() *Config {
	return a.cfg
}

// SaveConfig сохраняет новые настройки из React в файл config.json
func (a *App) SaveConfig(broker string, port int, stationsCount int, nodeNames []string, tgEnabled bool, tgToken string, tgChatID string) string {
	a.cfg.MqttBroker = broker
	a.cfg.MqttPort = port
	a.cfg.StationsCount = stationsCount
	a.cfg.TelegramEnabled = tgEnabled
	a.cfg.TelegramBotToken = tgToken
	a.cfg.TelegramChatId = tgChatID

	newNodes := make(map[string]string)
	for i, name := range nodeNames {
		newNodes[strconv.Itoa(i+1)] = strings.TrimSpace(name)
	}
	a.cfg.NodeNames = newNodes

	err := SaveConfigToFile(a.cfg, "config.json")
	if err != nil {
		return fmt.Sprintf("Ошибка сохранения: %v", err)
	}

	if a.mqttClient != nil && a.mqttClient.IsConnected() {
		a.mqttClient.Disconnect(250)
	}
	a.initMQTT()

	return "✅ Настройки сохранены!"
}

// SelectSoundFile открывает нативный диалог проводника для выбора MP3/WAV файла
func (a *App) SelectSoundFile() string {
	filePath, err := runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "Выбрать звуковой файл сирены",
		Filters: []runtime.FileFilter{
			{DisplayName: "Аудиофайлы (*.mp3; *.wav)", Pattern: "*.mp3;*.wav"},
		},
	})
	if err != nil || filePath == "" {
		return ""
	}

	a.cfg.SoundFilePath = filePath
	SaveConfigToFile(a.cfg, "config.json")
	return filePath
}

// GetAlarmSound кодирует выбранный аудиофайл в Base64 Data URL для воспроизведения в React
func (a *App) GetAlarmSound() string {
	if a.cfg.SoundFilePath == "" {
		return ""
	}

	if _, err := os.Stat(a.cfg.SoundFilePath); os.IsNotExist(err) {
		fmt.Printf("⚠️ Файл сирены не найден: %s. Откат на дефолтный.\n", a.cfg.SoundFilePath)
		return ""
	}

	data, err := os.ReadFile(a.cfg.SoundFilePath)
	if err != nil {
		return ""
	}

	mimeType := "audio/mp3"
	if strings.HasSuffix(strings.ToLower(a.cfg.SoundFilePath), ".wav") {
		mimeType = "audio/wav"
	}

	encoded := base64.StdEncoding.EncodeToString(data)
	return fmt.Sprintf("data:%s;base64,%s", mimeType, encoded)
}

// GetInitialState запрашивает из БД всю историю состояний и статистику для отображения на старте
func (a *App) GetInitialState() map[string]NodeUpdate {
	stateMap := make(map[string]NodeUpdate)
	if a.db == nil || a.cfg == nil {
		return stateMap
	}

	totalStations := a.cfg.StationsCount
	if totalStations == 0 {
		totalStations = 3
	}

	for s := 1; s <= totalStations; s++ {
		stationStr := fmt.Sprintf("Станок %d", s)
		for _, nodeName := range a.cfg.NodeNames { // Заменили nodeIDStr на _
			
			// Запрашиваем из БД статистику
			alarms, disconnects, _ := a.db.GetNodeStats(stationStr, nodeName)
			
			// Запрашиваем последнее известное состояние
			lastState := a.db.GetLastNodeState(stationStr, nodeName)

			key := fmt.Sprintf("Станок%d_%s", s, nodeName)
			stateMap[key] = NodeUpdate{
				Station:         s,
				NodeName:        nodeName,
				State:           lastState,
				Connected:       true, // Считаем подключенным по умолчанию
				Rssi:            0,
				AlarmCount:      alarms,
				DisconnectCount: disconnects,
			}
		}
	}

	return stateMap
}