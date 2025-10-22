// server.js

const express = require("express");
const ExcelJS = require("exceljs");
const path = require("path");
const fs = require("fs");
const moment = require("moment"); // Для получения таймстампа изменения файла

const app = express();
const port = 3001; // Выберем порт 3001 для API

// Путь к файлу Excel
const EXCEL_FILE_PATH = path.join(__dirname, "tel_book.xlsx");

/**
 * Функция для чтения Excel-файла, извлечения данных
 * и получения таймстампа последнего изменения.
 */
async function loadHandbookData() {
  console.log(`Попытка загрузить данные из: ${EXCEL_FILE_PATH}`);

  // 1. Проверяем существование файла
  if (!fs.existsSync(EXCEL_FILE_PATH)) {
    console.error("Файл tel_book.xlsx не найден!");
    return null;
  }

  const workbook = new ExcelJS.Workbook();
  try {
    // Чтение файла
    await workbook.xlsx.readFile(EXCEL_FILE_PATH);

    const officeData = [];
    const cabinetsData = [];

    // 2. Чтение листа "Офис"
    const officeSheet = workbook.getWorksheet("Офис");
    if (officeSheet) {
      // Заголовки (предполагаем, что они в первой строке)
      const headers = [
        "Отдел",
        "Должность",
        "ФИО",
        "Внутренний номер",
        "Общий номер отдела",
      ];

      officeSheet.eachRow((row, rowNumber) => {
        // Пропускаем строку заголовков
        if (rowNumber === 1) return;

        const rowValues = row.values.slice(1); // Удаляем первый пустой элемент
        if (rowValues.every((val) => !val)) return; // Пропускаем пустые строки

        officeData.push({
          department: rowValues[0] || "",
          position: rowValues[1] || "",
          fullName: rowValues[2] || "",
          internalNumber: rowValues[3] || "",
          generalNumber: rowValues[4] || "",
        });
      });
    }

    // 3. Чтение листа "Кабинеты"
    const cabinetsSheet = workbook.getWorksheet("Кабинеты");
    if (cabinetsSheet) {
      // Заголовки (предполагаем, что они в первой строке)
      const headers = ["Город", "Адрес", "Внутренний номер"];

      cabinetsSheet.eachRow((row, rowNumber) => {
        // Пропускаем строку заголовков
        if (rowNumber === 1) return;

        const rowValues = row.values.slice(1); // Удаляем первый пустой элемент
        if (rowValues.every((val) => !val)) return; // Пропускаем пустые строки

        cabinetsData.push({
          city: rowValues[0] || "",
          address: rowValues[1] || "",
          internalNumber: rowValues[2] || "",
        });
      });
    }

    // 4. Получение таймстампа последнего изменения файла
    const stats = fs.statSync(EXCEL_FILE_PATH);
    // Используем mtimeMs (Modification Time в миллисекундах) как наш таймстамп
    const lastModifiedTimestamp = stats.mtimeMs;

    console.log(
      `Данные успешно загружены. Таймстамп: ${lastModifiedTimestamp}`
    );

    return {
      timestamp: lastModifiedTimestamp,
      office: officeData,
      cabinets: cabinetsData,
    };
  } catch (error) {
    console.error("Ошибка при обработке Excel-файла:", error);
    return null;
  }
}

// CORS (В реальном проекте замени это на конкретный домен портала)
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header(
    "Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Accept"
  );
  next();
});

// Эндпоинт для получения данных справочника
app.get("/api/handbook", async (req, res) => {
  const data = await loadHandbookData();

  if (data) {
    res.json({
      status: "success",
      data: data,
    });
  } else {
    res.status(500).json({
      status: "error",
      message: "Не удалось загрузить данные справочника.",
    });
  }
});

app.listen(port, () => {
  console.log(`API-сервер запущен на http://localhost:${port}`);
  console.log(`Эндпоинт для данных: http://localhost:${port}/api/handbook`);
});
