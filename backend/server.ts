import express, { Request, Response, NextFunction } from "express";
import ExcelJS from "exceljs";
import path from "path";
import fs from "fs";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import winston from "winston";
import sanitizeHtml from "sanitize-html";
import dotenv from "dotenv";

dotenv.config();

// Проверка наличия обязательных переменных окружения при старте
const requiredEnvVars = ['PORT', 'EXCEL_FILE_NAME', 'ALLOWED_ORIGINS', 'NODE_ENV'];
const missingEnvVars = requiredEnvVars.filter(varName => !process.env[varName]);
if (missingEnvVars.length > 0) {
  throw new Error(`ОШИБКА: Отсутствуют переменные окружения: ${missingEnvVars.join(', ')}`);
}

const app = express();
const PORT = process.env.PORT || 3001;
const EXCEL_FILE_PATH = path.resolve(__dirname, "..", process.env.EXCEL_FILE_NAME!);
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS?.split(",") || [];

// Data Interfaces
interface OfficeEmployee {
  department: string;
  sortPriority: number;
  position: string;
  fullName: string;
  internalNumber: string;
  generalNumber: string;
}

interface Cabinet {
  city: string;
  address: string;
  internalNumber: string;
}

interface HandbookData {
  timestamp: number;
  office: OfficeEmployee[];
  cabinets: Cabinet[];
}

// Настройка логгера
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || "info",
  format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
  transports: [
    new winston.transports.File({ filename: "logs/error.log", level: "error" }),
    new winston.transports.File({ filename: "logs/combined.log" }),
    new winston.transports.Console({ format: winston.format.simple() }),
  ],
});

if (!fs.existsSync("logs")) {
  fs.mkdirSync("logs");
}

// Кэш данных в памяти
let cachedData: HandbookData | null = null;
let lastModifiedTime = 0;

/**
 * Очищает строку от HTML-тегов для предотвращения XSS-атак.
 * @param input - Входная строка.
 * @returns Очищенная строка.
 */
function sanitizeString(input: any): string {
  if (!input) return "";
  return sanitizeHtml(String(input), { allowedTags: [], allowedAttributes: {} }).trim();
}

/**
 * Загружает и парсит данные из Excel-файла.
 * Использует кэширование в памяти: если файл не был изменен с момента
 * последней загрузки, возвращает данные из кэша.
 * @returns Объект с данными справочника или null в случае ошибки.
 */
async function loadHandbookData(): Promise<HandbookData | null> {
  try {
    if (!fs.existsSync(EXCEL_FILE_PATH)) {
      logger.error(`Файл не найден: ${EXCEL_FILE_PATH}`);
      return null;
    }

    const stats = fs.statSync(EXCEL_FILE_PATH);
    const currentModTime = stats.mtimeMs;

    if (cachedData && lastModifiedTime === currentModTime) {
      logger.info("Возврат данных из кэша.");
      return cachedData;
    }

    logger.info(`Загрузка данных из: ${EXCEL_FILE_PATH}`);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(EXCEL_FILE_PATH);

    const officeData: OfficeEmployee[] = [];
    const cabinetsData: Cabinet[] = [];

    const officeSheet = workbook.getWorksheet("Офис");
    if (officeSheet) {
      officeSheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return;
        const cleanValues = (row.values as any[]).slice(1);
        if (cleanValues.every((val) => !val)) return;

        officeData.push({
          department: sanitizeString(cleanValues[0]),
          sortPriority: parseInt(sanitizeString(cleanValues[1])) || 99,
          position: sanitizeString(cleanValues[2]),
          fullName: sanitizeString(cleanValues[3]),
          internalNumber: sanitizeString(cleanValues[4]),
          generalNumber: sanitizeString(cleanValues[5]),
        });
      });
    }

    const cabinetsSheet = workbook.getWorksheet("Кабинеты");
    if (cabinetsSheet) {
      cabinetsSheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return;
        const cleanValues = (row.values as any[]).slice(1);
        if (cleanValues.every((val) => !val)) return;

        cabinetsData.push({
          city: sanitizeString(cleanValues[0]),
          address: sanitizeString(cleanValues[1]),
          internalNumber: sanitizeString(cleanValues[2]),
        });
      });
    }

    cachedData = {
      timestamp: currentModTime,
      office: officeData,
      cabinets: cabinetsData,
    };
    lastModifiedTime = currentModTime;

    logger.info(`Данные загружены. Офис: ${officeData.length}, Кабинеты: ${cabinetsData.length}`);
    return cachedData;
  } catch (error) {
    logger.error("Ошибка при обработке Excel-файла:", error);
    return null;
  }
}

// --- MIDDLEWARES ---

// Принудительный редирект на HTTPS в production-среде
app.use((req: Request, res: Response, next: NextFunction) => {
  if (process.env.NODE_ENV === "production" && req.headers["x-forwarded-proto"] !== "https") {
    return res.redirect(301, `https://${req.headers.host}${req.url}`);
  }
  next();
});

// Установка защитных HTTP-заголовков
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));

// Настройка CORS
app.use((req: Request, res: Response, next: NextFunction) => {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.header("Access-Control-Allow-Origin", origin);
  }
  res.header("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

// Ограничение количества запросов
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use("/api/", limiter);

// Логирование всех входящих запросов
app.use((req: Request, res: Response, next: NextFunction) => {
  logger.info(`${req.method} ${req.path} - ${req.ip}`);
  next();
});

// --- ROUTES ---

// Эндпоинт для проверки состояния сервера
app.get("/health", (req: Request, res: Response) => {
  res.json({
    status: "ok",
    uptime: process.uptime(),
    cacheStatus: cachedData ? "active" : "empty",
  });
});

// Основной эндпоинт для получения данных справочника
app.get("/api/handbook", async (req: Request, res: Response) => {
  try {
    const data = await loadHandbookData();
    if (data) {
      res.json({ status: "success", data });
    } else {
      res.status(500).json({ status: "error", message: "Не удалось загрузить данные справочника." });
    }
  } catch (error) {
    logger.error("Ошибка в /api/handbook:", error);
    res.status(500).json({ status: "error", message: "Внутренняя ошибка сервера." });
  }
});

// --- SERVING FRONTEND & ERROR HANDLING ---

// Раздача статических файлов собранного React-приложения
const frontendBuildPath = path.resolve(__dirname, "../../frontend/build");
app.use(express.static(frontendBuildPath));

// Обработчик для React Router: на все остальные запросы отдает index.html
app.get("*", (req: Request, res: Response) => {
  res.sendFile(path.join(frontendBuildPath, "index.html"));
});

// Глобальный обработчик ошибок
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  logger.error("Необработанная ошибка:", err);
  res.status(500).json({ status: "error", message: "Внутренняя ошибка сервера" });
});

// Запуск сервера
app.listen(PORT, () => {
  logger.info(`API-сервер запущен на порту ${PORT}`);
  logger.info(`Environment: ${process.env.NODE_ENV}`);
  loadHandbookData(); // Предзагрузка данных при старте
});