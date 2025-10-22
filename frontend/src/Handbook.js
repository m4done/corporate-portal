// src/Handbook.js (Обновленный код)

import React, { useState, useEffect, useMemo, useCallback } from "react";
import localforage from "localforage";
import moment from "moment";
import "./Handbook.css";

// --- 1. Константы и Настройки ---
const CACHE_KEY = "handbook_data_cache";
const API_URL = "http://localhost:3001/api/handbook";
const MAX_CACHE_AGE_HOURS = 24;

// --- 2. Вспомогательные функции (вне компонента) ---

/**
 * Группирует и сортирует массив данных "Офис".
 */
const groupAndSortOfficeData = (data) => {
  // 1. Сортировка по ФИО для порядка внутри групп
  const sortedByFullName = data.sort((a, b) => {
    const nameA = a.fullName.toLowerCase();
    const nameB = b.fullName.toLowerCase();
    if (nameA < nameB) return -1;
    if (nameA > nameB) return 1;
    return 0;
  });

  // 2. Группировка по отделу
  const grouped = sortedByFullName.reduce((acc, employee) => {
    const dept = employee.department || "Без отдела";
    if (!acc[dept]) {
      acc[dept] = {
        employees: [],
        generalNumber: employee.generalNumber || "—",
      };
    }
    acc[dept].employees.push(employee);
    return acc;
  }, {});

  // 3. Финальная сортировка по названию отдела
  const sortedGroupedKeys = Object.keys(grouped).sort((a, b) => {
    return a.toLowerCase().localeCompare(b.toLowerCase());
  });

  const finalGroupedData = {};
  sortedGroupedKeys.forEach((key) => {
    finalGroupedData[key] = grouped[key];
  });

  return finalGroupedData;
};

/**
 * Сортирует массив данных "Кабинеты"
 */
const sortCabinetData = (data) => {
  return data.sort((a, b) => {
    const cityA = a.city.toLowerCase();
    const cityB = b.city.toLowerCase();
    if (cityA < cityB) return -1;
    if (cityA > cityB) return 1;

    const addressA = a.address.toLowerCase();
    const addressB = b.address.toLowerCase();
    if (addressA < addressB) return -1;
    if (addressA > addressB) return 1;
    return 0;
  });
};

/**
 * Очищает кэш IndexedDB
 */
const clearCache = async () => {
  await localforage.removeItem(CACHE_KEY);
  console.log("Кэш успешно очищен.");
};

// --- 3. Основной компонент Справочник ---

const Handbook = () => {
  const [data, setData] = useState({ office: [], cabinets: [] });
  const [activeTab, setActiveTab] = useState("office");
  const [searchQuery, setSearchQuery] = useState("");
  const [loadingStatus, setLoadingStatus] = useState("Загрузка данных...");
  const [lastUpdated, setLastUpdated] = useState(null);
  const [expandedDepartments, setExpandedDepartments] = useState([]);

  // --- 4. Логика загрузки и кэширования (Без изменений) ---

  const fetchData = useCallback(async (forceUpdate = false) => {
    setLoadingStatus("Проверка данных...");

    let cachedData = null;
    try {
      cachedData = await localforage.getItem(CACHE_KEY);
    } catch (e) {
      console.error("Ошибка чтения кэша:", e);
    }

    const isOnline = navigator.onLine;

    if (isOnline || forceUpdate) {
      setLoadingStatus(
        isOnline ? "Обновление данных..." : "Попытка обновления..."
      );
      try {
        const response = await fetch(API_URL);
        if (!response.ok)
          throw new Error(`HTTP error! status: ${response.status}`);
        const result = await response.json();

        const newData = {
          office: groupAndSortOfficeData(result.data.office),
          cabinets: sortCabinetData(result.data.cabinets),
        };

        const newCache = {
          data: newData,
          timestamp: result.data.timestamp,
          fetchTime: Date.now(),
        };
        await localforage.setItem(CACHE_KEY, newCache);

        setData(newData);
        setLastUpdated(newCache.fetchTime);
        setLoadingStatus("Данные успешно загружены с сервера.");
        return;
      } catch (error) {
        console.error("Ошибка загрузки данных с API:", error);

        if (cachedData && cachedData.data) {
          setData(cachedData.data);
          setLastUpdated(cachedData.fetchTime);
          setLoadingStatus("Ошибка сети. Загружены данные из локального кэша.");
          return;
        }
        setLoadingStatus(
          "Ошибка загрузки и кэш недоступен. Проверьте подключение."
        );
        return;
      }
    }

    if (cachedData && cachedData.data) {
      const cacheAgeHours = moment().diff(
        moment(cachedData.fetchTime),
        "hours"
      );
      const isStale = cacheAgeHours >= MAX_CACHE_AGE_HOURS;

      setData(cachedData.data);
      setLastUpdated(cachedData.fetchTime);
      setLoadingStatus(
        isStale
          ? "Загружены данные из кэша. (Данные старше 24 часов)."
          : "Данные загружены из кэша."
      );
    } else {
      setLoadingStatus("Нет подключения к сети и нет локального кэша.");
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleUpdate = async () => {
    await clearCache();
    fetchData(true);
  };

  // --- 5. Логика поиска и фильтрации (Без изменений) ---

  const filterData = useCallback((items, query, keys) => {
    if (!query) return items;
    const lowerQuery = query.toLowerCase();

    return items.filter((item) =>
      keys.some((key) => {
        const value = String(item[key] || "").toLowerCase();
        return value.includes(lowerQuery);
      })
    );
  }, []);

  const filteredOffice = useMemo(() => {
    // 1. Получаем ключи для поиска
    const searchKeys = [
      "department",
      "position",
      "fullName",
      "internalNumber",
      "generalNumber",
    ];

    // 2. Если нет поискового запроса, возвращаем все сгруппированные данные
    if (!searchQuery) {
      return data.office;
    }

    // 3. Если поиск активен:
    const filteredGroupedData = {};

    // Перебираем все отделы в исходных данных
    Object.keys(data.office).forEach((deptName) => {
      const group = data.office[deptName];

      // Фильтруем сотрудников внутри отдела
      const filteredEmployees = filterData(
        group.employees,
        searchQuery,
        searchKeys
      );

      // Если в отделе есть совпадения (или сам отдел совпал с запросом)
      // Мы используем employees (плоский список) в filterData, поэтому проверяем только сотрудников.
      if (filteredEmployees.length > 0) {
        filteredGroupedData[deptName] = {
          // Возвращаем только отфильтрованных сотрудников
          employees: filteredEmployees,
          // Сохраняем общий номер отдела
          generalNumber: group.generalNumber,
        };
      }
    });

    // 4. Возвращаем отфильтрованные и сгруппированные данные
    return filteredGroupedData;
  }, [data.office, searchQuery, filterData]);

  const filteredCabinets = useMemo(() => {
    const keys = ["city", "address", "internalNumber"];
    return filterData(data.cabinets, searchQuery, keys);
  }, [data.cabinets, searchQuery, filterData]);

  // --- 6. Логика разворачивания/сворачивания группы (Без изменений) ---

  const toggleDepartment = (deptName) => {
    setExpandedDepartments((prev) =>
      prev.includes(deptName)
        ? prev.filter((name) => name !== deptName)
        : [...prev, deptName]
    );
  };

  // --- 7. Функции рендера таблиц (Изменения здесь) ---

  const renderOfficeTable = (items) => {
    const departmentKeys = Object.keys(items);

    if (departmentKeys.length === 0) {
      if (searchQuery) {
        return (
          <p className="no-results">
            По вашему запросу не найдено ни одного сотрудника.
          </p>
        );
      }
      return <p className="no-results">Нет данных для отображения.</p>;
    }

    // Функция для сброса поиска
    const resetSearch = () => setSearchQuery("");

    return (
      <div className="office-grouped-list">
        {departmentKeys.map((deptName) => {
          const group = items[deptName];
          // Разворачиваем автоматически, если идет поиск, или если пользователь развернул
          const isExpanded =
            expandedDepartments.includes(deptName) || searchQuery;

          return (
            <div key={deptName} className="department-group">
              {/* Заголовок группы (Отдел) - Общий номер здесь остается */}
              <div
                className={`department-header ${isExpanded ? "expanded" : ""}`}
                onClick={searchQuery ? null : () => toggleDepartment(deptName)}
                tabIndex="0"
                role="button"
                style={searchQuery ? { cursor: "default" } : {}}
              >
                <span className="dept-name">{deptName}</span>
                <span className="dept-general-number">
                  Общий номер отдела: {group.generalNumber}
                </span>
                <span className="expand-icon">
                  {searchQuery ? "" : isExpanded ? "▼" : "▶"}
                </span>
              </div>

              {/* Таблица сотрудников (Разворачиваемая часть) */}
              <div className={`employee-list ${isExpanded ? "open" : ""}`}>
                <div className="table-container">
                  <table>
                    <thead>
                      <tr>
                        <th>ФИО / Должность</th>
                        {/* Изменено: Оставили только одну колонку для внутреннего номера */}
                        <th>Внутренний номер</th>
                      </tr>
                    </thead>
                    <tbody>
                      {group.employees.map((employee, index) => (
                        <tr key={index}>
                          <td className="person-details">
                            <div className="full-name">{employee.fullName}</div>
                            <div className="position">{employee.position}</div>
                          </td>
                          {/* Внутренний номер остается в своей колонке */}
                          <td>{employee.internalNumber}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  const renderCabinetTable = (items) => (
    <div className="table-container">
      <table>
        <thead>
          <tr>
            <th>Город</th>
            <th>Адрес</th>
            {/* Изменено: Уменьшаем количество колонок */}
            <th>Внутренний номер</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, index) => (
            <tr key={index}>
              <td>{item.city}</td>
              <td>{item.address}</td>
              <td>{item.internalNumber}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {items.length === 0 && (
        <p className="no-results">
          По вашему запросу не найдено ни одного кабинета.
        </p>
      )}
    </div>
  );

  // --- 8. Рендер компонента (Удалены все счетчики) ---

  return (
    <div className="handbook-container">
      <h1>Корпоративный Справочник</h1>

      {/* Блок управления: Удалена кнопка "Обновить данные" */}
      <div className="controls-panel">
        <div className="search-wrapper">
          <input
            type="text"
            placeholder="Быстрый поиск"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="search-input"
          />
          {/* Элемент сброса поиска */}
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="search-clear-button"
            >
              &times;
            </button>
          )}
        </div>
      </div>

      {/* Статус - Без изменений */}
      <div className="status-bar" style={{ justifyContent: "flex-end" }}>
        {lastUpdated && (
          <span className="last-update">
            Обновлено: {moment(lastUpdated).format("DD.MM.YYYY HH:mm:ss")}
          </span>
        )}
      </div>

      {/* Вкладки */}
      <div className="tabs">
        <button
          className={`tab-button ${activeTab === "office" ? "active" : ""}`}
          onClick={() => setActiveTab("office")}
        >
          Офис
        </button>
        <button
          className={`tab-button ${activeTab === "cabinets" ? "active" : ""}`}
          onClick={() => setActiveTab("cabinets")}
        >
          Кабинеты
        </button>
      </div>

      {/* Контент таблицы */}
      <div className="tab-content">
        {activeTab === "office" && renderOfficeTable(filteredOffice)}
        {activeTab === "cabinets" && renderCabinetTable(filteredCabinets)}
      </div>

      {/* Кнопка "Обновить данные" скрыта, но функционал доступен, если понадобится. 
            Если нужно полностью убрать - удали функцию handleUpdate. 
            Поскольку я ее просто убрал из DOM, но не из кода, ты можешь ее вернуть, если захочешь.
        */}
    </div>
  );
};

export default Handbook;
