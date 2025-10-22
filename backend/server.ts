// server.ts
import express, { Request, Response, NextFunction } from "express";
import ExcelJS from "exceljs";
import path from "path";
import fs from "fs";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import winston from "winston";
import sanitizeHtml from "sanitize-html";
import { format } from "date-fns";
import dotenv from "dotenv";

dotenv.config();

const requiredEnvVars = [
  "PORT",
  "EXCEL_FILE_NAME",
  "ALLOWED_ORIGINS",
  "NODE_ENV",
];
const missingEnvVars = requiredEnvVars.filter(
  (varName) => !process.env[varName]
);

if (missingEnvVars.length > 0) {
  throw new Error(
    `ОШИБКА: Отсутствуют обязательные переменные окружения в .env файле: ${missingEnvVars.join(
      ", "
    )}`
  );
}

const app = express();
const PORT = process.env.PORT || 3001;
const EXCEL_FILE_PATH = path.resolve(
  __dirname,
  "..",
  process.env.EXCEL_FILE_NAME || "tel_book.xlsx"
);
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS?.split(",") || ["*"];

// Типы данных
interface OfficeEmployee {
  department: string;
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

// Настройка логирования
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || "info",
  format: winston.format.combine(
    winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: "logs/error.log", level: "error" }),
    new winston.transports.File({ filename: "logs/combined.log" }),
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      ),
    }),
  ],
});

// Создаем папку для логов
if (!fs.existsSync("logs")) {
  fs.mkdirSync("logs");
}

// Кэш данных
let cachedData: HandbookData | null = null;
let lastModifiedTime = 0;

/**
 * Санитизация строки от потенциально опасного HTML/JS
 */
function sanitizeString(input: any): string {
  if (!input) return "";
  return sanitizeHtml(String(input), {
    allowedTags: [],
    allowedAttributes: {},
  }).trim();
}

/**
 * Функция для чтения Excel-файла с кэшированием
 */
async function loadHandbookData(): Promise<HandbookData | null> {
  try {
    // Проверяем существование файла
    if (!fs.existsSync(EXCEL_FILE_PATH)) {
      logger.error(`Файл не найден: ${EXCEL_FILE_PATH}`);
      return null;
    }

    const stats = fs.statSync(EXCEL_FILE_PATH);
    const currentModTime = stats.mtimeMs;

    // Возвращаем кэш если файл не изменился
    if (cachedData && lastModifiedTime === currentModTime) {
      logger.info("Возврат данных из кэша");
      return cachedData;
    }

    logger.info(`Загрузка данных из: ${EXCEL_FILE_PATH}`);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(EXCEL_FILE_PATH);

    const officeData: OfficeEmployee[] = [];
    const cabinetsData: Cabinet[] = [];

    // Чтение листа "Офис"
    const officeSheet = workbook.getWorksheet("Офис");
    if (officeSheet) {
      officeSheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return; // Пропускаем заголовки

        const rowValues = row.values as any[];
        const cleanValues = rowValues.slice(1);

        if (cleanValues.every((val) => !val)) return; // Пропускаем пустые строки

        officeData.push({
          department: sanitizeString(cleanValues[0]),
          position: sanitizeString(cleanValues[1]),
          fullName: sanitizeString(cleanValues[2]),
          internalNumber: sanitizeString(cleanValues[3]),
          generalNumber: sanitizeString(cleanValues[4]),
        });
      });
    }

    // Чтение листа "Кабинеты"
    const cabinetsSheet = workbook.getWorksheet("Кабинеты");
    if (cabinetsSheet) {
      cabinetsSheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return;

        const rowValues = row.values as any[];
        const cleanValues = rowValues.slice(1);

        if (cleanValues.every((val) => !val)) return;

        cabinetsData.push({
          city: sanitizeString(cleanValues[0]),
          address: sanitizeString(cleanValues[1]),
          internalNumber: sanitizeString(cleanValues[2]),
        });
      });
    }

    // Обновляем кэш
    cachedData = {
      timestamp: currentModTime,
      office: officeData,
      cabinets: cabinetsData,
    };
    lastModifiedTime = currentModTime;

    logger.info(
      `Данные загружены. Офис: ${officeData.length}, Кабинеты: ${cabinetsData.length}`
    );

    return cachedData;
  } catch (error) {
    logger.error("Ошибка при обработке Excel-файла:", error);
    return null;
  }
}

// Middleware для принудительного HTTPS (кроме локальной разработки)
app.use((req: Request, res: Response, next: NextFunction) => {
  if (
    process.env.NODE_ENV === "production" &&
    req.headers["x-forwarded-proto"] !== "https"
  ) {
    return res.redirect(301, `https://${req.headers.host}${req.url}`);
  }
  next();
});

// Helmet для безопасности заголовков
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  })
);

// CORS настройка
app.use((req: Request, res: Response, next: NextFunction) => {
  const origin = req.headers.origin;

  if (
    ALLOWED_ORIGINS.includes("*") ||
    (origin && ALLOWED_ORIGINS.includes(origin))
  ) {
    res.header("Access-Control-Allow-Origin", origin || "*");
    res.header("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.header(
      "Access-Control-Allow-Headers",
      "Origin, X-Requested-With, Content-Type, Accept"
    );
  }

  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }

  next();
});

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: {
    status: "error",
    message: "Слишком много запросов. Попробуйте через 15 минут.",
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req: Request, res: Response) => {
    logger.warn(`Rate limit exceeded: ${req.ip}`);
    res.status(429).json({
      status: "error",
      message: "Слишком много запросов. Попробуйте через 15 минут.",
    });
  },
});

app.use("/api/", limiter);
app.use("/health", limiter);

const frontendBuildPath = path.resolve(__dirname, "../../frontend/build");

app.use(express.static(frontendBuildPath));

// Логирование запросов
app.use((req: Request, res: Response, next: NextFunction) => {
  logger.info(`${req.method} ${req.path} - ${req.ip}`);
  next();
});

// Health check endpoint
app.get("/health", (req: Request, res: Response) => {
  // ... (ваш код health check)
  const health = {
    status: "ok",
    timestamp: Date.now(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || "development",
    cacheStatus: cachedData ? "active" : "empty",
  };
  res.json(health);
});

// Эндпоинт для получения данных справочника
app.get("/api/handbook", async (req: Request, res: Response) => {
  // ... (ваш код /api/handbook)
  try {
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
  } catch (error) {
    logger.error("Ошибка в /api/handbook:", error);
    res.status(500).json({
      status: "error",
      message: "Внутренняя ошибка сервера.",
    });
  }
});

// Для ЛЮБОГО ДРУГОГО запроса, который не API и не статический файл,
// отдаем главный index.html. Это позволяет React Router работать.
app.get("*", (req: Request, res: Response, next: NextFunction) => {
  // Игнорируем API-маршруты, чтобы они случайно не отдали index.html
  if (req.path.startsWith("/api/") || req.path.startsWith("/health")) {
    return next();
  }

  const indexPath = path.join(frontendBuildPath, "index.html");

  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    // Если index.html не найден (сборка не прошла)
    res.status(500).json({
      status: "error",
      message: "Frontend build not found. Run 'npm run build' in /frontend.",
    });
  }
});

// 404 для несуществующих роутов
app.use((req: Request, res: Response) => {
  res.status(404).json({
    status: "error",
    message: "Endpoint не найден",
  });
});

// Глобальная обработка ошибок
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  logger.error("Необработанная ошибка:", err);
  res.status(500).json({
    status: "error",
    message: "Внутренняя ошибка сервера",
  });
});

// Запуск сервера
app.listen(PORT, () => {
  logger.info(`API-сервер запущен на порту ${PORT}`);
  logger.info(`Health check: http://localhost:${PORT}/health`);
  logger.info(`API endpoint: http://localhost:${PORT}/api/handbook`);
  logger.info(`Environment: ${process.env.NODE_ENV || "development"}`);

  // Предзагрузка данных
  loadHandbookData().catch((err) => {
    logger.error("Ошибка предзагрузки данных:", err);
  });
});

// Graceful shutdown
process.on("SIGTERM", () => {
  logger.info("SIGTERM получен. Завершение работы...");
  process.exit(0);
});

process.on("SIGINT", () => {
  logger.info("SIGINT получен. Завершение работы...");
  process.exit(0);
});
