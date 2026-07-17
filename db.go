// db.go
package main

import (
	"database/sql"
	"fmt"
	"strconv" // Добавили необходимый импорт!
	_ "github.com/glebarez/go-sqlite"
)

type DBManager struct {
	db *sql.DB
}

func NewDBManager(dbPath string) (*DBManager, error) {
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		return nil, err
	}
	return &DBManager{db: db}, nil
}

func (m *DBManager) InitDatabase() error {
	query := `
	CREATE TABLE IF NOT EXISTS events (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		timestamp TEXT NOT NULL,
		station TEXT NOT NULL,
		node TEXT NOT NULL,
		event_type TEXT NOT NULL,
		value TEXT,
		comment TEXT
	);
	CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp);
	`
	_, err := m.db.Exec(query)
	if err != nil {
		return fmt.Errorf("ошибка создания таблиц: %v", err)
	}
	return nil
}

func (m *DBManager) LogEvent(station string, node string, eventType string, value string, comment string) error {
	query := `
	INSERT INTO events (timestamp, station, node, event_type, value, comment)
	VALUES (datetime('now', 'localtime'), ?, ?, ?, ?, ?)
	`
	_, err := m.db.Exec(query, station, node, eventType, value, comment)
	if err != nil {
		return fmt.Errorf("ошибка записи события: %v", err)
	}
	return nil
}

// GetEvents возвращает все события из базы данных для экспорта в Excel
func (m *DBManager) GetEvents() (*sql.Rows, error) {
	return m.db.Query("SELECT timestamp, station, node, event_type, value, comment FROM events ORDER BY id DESC")
}

// GetNodeStats считает общее количество тревог и потерь связи для узла из истории БД
func (m *DBManager) GetNodeStats(station string, node string) (int, int, error) {
	var alarmCount, disconnectCount int

	err := m.db.QueryRow("SELECT COUNT(*) FROM events WHERE station = ? AND node = ? AND event_type = 'alarm'", station, node).Scan(&alarmCount)
	if err != nil {
		return 0, 0, err
	}

	err = m.db.QueryRow("SELECT COUNT(*) FROM events WHERE station = ? AND node = ? AND event_type = 'disconnect'", station, node).Scan(&disconnectCount)
	if err != nil {
		return 0, 0, err
	}

	return alarmCount, disconnectCount, nil
}

// GetLastNodeState возвращает последнее известное состояние узла (0 - норма, 1 - тревога, -1 - нет данных)
func (m *DBManager) GetLastNodeState(station string, node string) int {
	var value string
	err := m.db.QueryRow(`
		SELECT value FROM events 
		WHERE station = ? AND node = ? AND event_type IN ('alarm', 'normal')
		ORDER BY id DESC LIMIT 1
	`, station, node).Scan(&value)
	
	if err != nil {
		return -1 
	}
	
	valInt, _ := strconv.Atoi(value)
	return valInt
}