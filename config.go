// config.go
package main

import (
	"encoding/json"
	"os"
)

type Config struct {
	MqttBroker        string            `json:"mqtt_broker"`
	MqttPort          int               `json:"mqtt_port"`
	StationsCount     int               `json:"stations_count"`
	SoundFilePath     string            `json:"sound_file_path"` // Путь к выбранному файлу звука
	NodeNames         map[string]string `json:"node_names"`
	TelegramEnabled   bool              `json:"telegram_enabled"`
	TelegramBotToken  string            `json:"telegram_bot_token"`
	TelegramChatId    string            `json:"telegram_chat_id"`
}

func GetDefaultConfig() *Config {
	return &Config{
		MqttBroker:    "127.0.0.1",
		MqttPort:      1883,
		StationsCount: 3,
		SoundFilePath: "", // По умолчанию пусто (используется встроенный звук)
		NodeNames: map[string]string{
			"1": "Станок",
			"2": "Ультразвук",
			"3": "Чилер",
		},
		TelegramEnabled:  false,
		TelegramBotToken: "ТОКЕН_ВАШЕГО_БОТА",
		TelegramChatId:   "ID_ВАШЕГО_ЧАТА",
	}
}

// Вспомогательный метод сохранения конфига в файл (чтобы не дублировать код)
func SaveConfigToFile(cfg *Config, filePath string) error {
	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(filePath, data, 0644)
}

func LoadConfig(filePath string) (*Config, error) {
	if _, err := os.Stat(filePath); os.IsNotExist(err) {
		cfg := GetDefaultConfig()
		err = SaveConfigToFile(cfg, filePath)
		if err != nil {
			return nil, err
		}
		return cfg, nil
	}

	data, err := os.ReadFile(filePath)
	if err != nil {
		return nil, err
	}

	var cfg Config
	err = json.Unmarshal(data, &cfg)
	if err != nil {
		return nil, err
	}

	return &cfg, nil
}