package main

import (
	"fmt"
	"github.com/xuri/excelize/v2"
)

func ExportToExcel(filePath string, db *DBManager) error {
	rows, err := db.GetEvents()
	if err != nil {
		return fmt.Errorf("ошибка запроса к БД: %v", err)
	}
	defer rows.Close()

	f := excelize.NewFile()
	defer f.Close()

	sheetName := "Лог событий"
	f.SetSheetName("Sheet1", sheetName)

	headers := []string{"Дата и Время", "Станция", "Узел", "Тип события", "Значение", "Комментарий"}
	for i, h := range headers {
		cell, _ := excelize.CoordinatesToCellName(i+1, 1)
		f.SetCellValue(sheetName, cell, h)
	}

	rowIdx := 2
	for rows.Next() {
		var timestamp, station, node, eventType, value, comment string
		err := rows.Scan(&timestamp, &station, &node, &eventType, &value, &comment)
		if err != nil {
			return fmt.Errorf("ошибка чтения строки БД: %v", err)
		}

		f.SetCellValue(sheetName, fmt.Sprintf("A%d", rowIdx), timestamp)
		f.SetCellValue(sheetName, fmt.Sprintf("B%d", rowIdx), station)
		f.SetCellValue(sheetName, fmt.Sprintf("C%d", rowIdx), node)
		f.SetCellValue(sheetName, fmt.Sprintf("D%d", rowIdx), eventType)
		f.SetCellValue(sheetName, fmt.Sprintf("E%d", rowIdx), value)
		f.SetCellValue(sheetName, fmt.Sprintf("F%d", rowIdx), comment)
		rowIdx++
	}

	f.SetColWidth(sheetName, "A", "A", 22)
	f.SetColWidth(sheetName, "B", "C", 16)
	f.SetColWidth(sheetName, "D", "E", 16)
	f.SetColWidth(sheetName, "F", "F", 35)

	if err := f.SaveAs(filePath); err != nil {
		return fmt.Errorf("не удалось сохранить файл: %v", err)
	}

	return nil
}