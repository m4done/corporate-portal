import React, {
  useState,
  useEffect,
  useMemo,
  useCallback,
  useRef,
} from "react";
import localforage from "localforage";
import { format, differenceInHours } from "date-fns";
import "./Handbook.css";

// Interfaces
interface OfficeEmployee {
  department: string;
  position: string;
  fullName: string;
  internalNumber: string;
  generalNumber: string;
  sortPriority: number;
}

interface Cabinet {
  city: string;
  address: string;
  internalNumber: string;
}

interface GroupedOfficeData {
  [department: string]: {
    employees: OfficeEmployee[];
    generalNumber: string;
  };
}

interface CachedData {
  data: {
    office: GroupedOfficeData;
    cabinets: Cabinet[];
  };
  timestamp: number;
  fetchTime: number;
}

// Constants
const CACHE_KEY = "handbook_data_cache";
const API_URL = process.env.REACT_APP_API_URL || "/api/handbook";
const MAX_CACHE_AGE_HOURS = 12;

/**
 * Группирует сотрудников по отделам и сортирует их внутри групп.
 * Сортировка происходит сначала по числовому приоритету, затем по ФИО.
 * @param data - Массив данных о сотрудниках.
 * @returns Объект с сгруппированными и отсортированными данными.
 */
const groupAndSortOfficeData = (data: OfficeEmployee[]): GroupedOfficeData => {
  const sortedByPriority = [...data].sort((a, b) => {
    const priorityCompare = a.sortPriority - b.sortPriority;
    if (priorityCompare !== 0) {
      return priorityCompare;
    }
    return a.fullName.toLowerCase().localeCompare(b.fullName.toLowerCase());
  });

  const grouped = sortedByPriority.reduce<GroupedOfficeData>(
    (acc, employee) => {
      const dept = employee.department || "Без отдела";
      if (!acc[dept]) {
        acc[dept] = {
          employees: [],
          generalNumber: employee.generalNumber || "—",
        };
      }
      acc[dept].employees.push(employee);
      return acc;
    },
    {}
  );

  const sortedKeys = Object.keys(grouped).sort((a, b) =>
    a.toLowerCase().localeCompare(b.toLowerCase())
  );

  const finalGroupedData: GroupedOfficeData = {};
  sortedKeys.forEach((key) => {
    finalGroupedData[key] = grouped[key];
  });

  return finalGroupedData;
};

/**
 * Сортирует данные о кабинетах сначала по городу, затем по адресу.
 * @param data - Массив данных о кабинетах.
 * @returns Отсортированный массив.
 */
const sortCabinetData = (data: Cabinet[]): Cabinet[] => {
  return [...data].sort((a, b) => {
    const cityCompare = a.city
      .toLowerCase()
      .localeCompare(b.city.toLowerCase());
    if (cityCompare !== 0) return cityCompare;
    return a.address.toLowerCase().localeCompare(b.address.toLowerCase());
  });
};

const Handbook: React.FC = () => {
  const [data, setData] = useState<{
    office: GroupedOfficeData;
    cabinets: Cabinet[];
  }>({ office: {}, cabinets: [] });

  const [activeTab, setActiveTab] = useState<"office" | "cabinets">("office");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [loadingStatus, setLoadingStatus] =
    useState<string>("Загрузка данных...");
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [expandedDepartments, setExpandedDepartments] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [preSearchExpanded, setPreSearchExpanded] = useState<string[] | null>(
    null
  );
  const [rawOfficeData, setRawOfficeData] = useState<OfficeEmployee[]>([]);

  /**
   * Загружает данные для справочника.
   */
  const fetchData = useCallback(async (forceUpdate = false) => {
    setLoadingStatus("Проверка данных...");
    setError(null);

    let cachedData: CachedData | null = null;
    try {
      cachedData = await localforage.getItem<CachedData>(CACHE_KEY);
    } catch (e) {
      console.warn("Ошибка чтения кэша (продолжаем без кэша):", e);
    }

    if (navigator.onLine || forceUpdate) {
      setLoadingStatus(
        navigator.onLine ? "Обновление данных..." : "Попытка обновления..."
      );
      try {
        const response = await fetch(API_URL);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        const result = await response.json();
        if (result.status !== "success") {
          throw new Error(result.message || "Ошибка получения данных");
        }

        const newData = {
          office: groupAndSortOfficeData(result.data.office),
          cabinets: sortCabinetData(result.data.cabinets),
        };
        setRawOfficeData(result.data.office);
        const newCache: CachedData = {
          data: newData,
          timestamp: result.data.timestamp,
          fetchTime: Date.now(),
        };

        await localforage.setItem(CACHE_KEY, newCache);
        setData(newData);
        setLastUpdated(newCache.fetchTime);
        setLoadingStatus("Данные успешно загружены с сервера.");
        return;
      } catch (error: any) {
        console.error("Ошибка загрузки данных с API:", error);
        setError(error.message || "Неизвестная ошибка");
        if (cachedData?.data) {
          setData(cachedData.data);
          setLastUpdated(cachedData.fetchTime);
          const flatData = Object.values(cachedData.data.office).flatMap(
            (group) => group.employees
          );
          setRawOfficeData(flatData);
          setLoadingStatus("Ошибка сети. Загружены данные из локального кэша.");
          return;
        }
        setLoadingStatus("Ошибка загрузки. Проверьте подключение к серверу.");
        return;
      }
    }

    if (cachedData?.data) {
      const cacheAgeHours = differenceInHours(
        new Date(),
        new Date(cachedData.fetchTime)
      );
      const isStale = cacheAgeHours >= MAX_CACHE_AGE_HOURS;
      setData(cachedData.data);
      setLastUpdated(cachedData.fetchTime);
      setLoadingStatus(
        isStale
          ? `Загружены данные из кэша (${cacheAgeHours}ч назад, рекомендуется обновить).`
          : "Данные загружены из кэша."
      );
    } else {
      setLoadingStatus("Нет подключения к сети и нет локального кэша.");
      setError("Данные недоступны");
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, []);

  const handleUpdate = async () => {
    await localforage.removeItem(CACHE_KEY);
    fetchData(true);
  };

  /**
   * Универсальная функция для фильтрации массива объектов по строковому запросу.
   */
  const filterData = useCallback(
    <T extends Record<string, any>>(
      items: T[],
      query: string,
      keys: (keyof T)[]
    ): T[] => {
      if (!query) return items;
      const lowerQuery = query.toLowerCase();
      return items.filter((item) =>
        keys.some((key) =>
          String(item[key] || "")
            .toLowerCase()
            .includes(lowerQuery)
        )
      );
    },
    []
  );

  const filteredOffice = useMemo(() => {
    if (!searchQuery) {
      return data.office;
    }

    const employeeSearchKeys: (keyof OfficeEmployee)[] = [
      "fullName",
      "position",
      "internalNumber",
    ];

    const filteredEmployees = filterData(
      rawOfficeData,
      searchQuery,
      employeeSearchKeys
    );

    return groupAndSortOfficeData(filteredEmployees);
  }, [searchQuery, data.office, rawOfficeData, filterData]);

  const filteredCabinets = useMemo(() => {
    const keys: (keyof Cabinet)[] = ["city", "address", "internalNumber"];
    return filterData(data.cabinets, searchQuery, keys);
  }, [data.cabinets, searchQuery, filterData]);

  useEffect(() => {
    if (!searchQuery) return;
    const hasOfficeResults = Object.keys(filteredOffice).length > 0;
    const hasCabinetsResults = filteredCabinets.length > 0;

    if (hasOfficeResults && !hasCabinetsResults && activeTab !== "office") {
      setActiveTab("office");
    } else if (
      !hasOfficeResults &&
      hasCabinetsResults &&
      activeTab !== "cabinets"
    ) {
      setActiveTab("cabinets");
    }
  }, [searchQuery, filteredOffice, filteredCabinets, activeTab]);

  useEffect(() => {
    if (searchQuery && preSearchExpanded === null) {
      setPreSearchExpanded([...expandedDepartments]);
    } else if (!searchQuery && preSearchExpanded !== null) {
      setExpandedDepartments(preSearchExpanded);
      setPreSearchExpanded(null);
    }
  }, [searchQuery, expandedDepartments, preSearchExpanded]);

  const toggleDepartment = (deptName: string) => {
    setExpandedDepartments((prev) =>
      prev.includes(deptName)
        ? prev.filter((name) => name !== deptName)
        : [...prev, deptName]
    );
  };

  const renderOfficeTable = (items: GroupedOfficeData) => {
    const departmentKeys = Object.keys(items);
    if (departmentKeys.length === 0) {
      return (
        <p className="no-results">
          {searchQuery
            ? "По вашему запросу ничего не найдено."
            : "Нет данных для отображения."}
        </p>
      );
    }
    return (
      <div className="office-grouped-list">
        {departmentKeys.map((deptName) => {
          const group = items[deptName];
          const isExpanded =
            expandedDepartments.includes(deptName) || !!searchQuery;
          return (
            <div key={deptName} className="department-group">
              <div
                className={`department-header ${isExpanded ? "expanded" : ""}`}
                onClick={
                  !searchQuery ? () => toggleDepartment(deptName) : undefined
                }
                style={searchQuery ? { cursor: "default" } : {}}
              >
                <span className="dept-name">{deptName}</span>
                <span className="dept-general-number">
                  Общий номер: {group.generalNumber}
                </span>
                <span className="expand-icon">
                  {!searchQuery && (isExpanded ? "▼" : "▶")}
                </span>
              </div>
              <div className={`employee-list ${isExpanded ? "open" : ""}`}>
                <div className="table-container">
                  <table>
                    <thead>
                      <tr>
                        <th>ФИО / Должность</th>
                        <th>Внутренний номер</th>
                      </tr>
                    </thead>
                    <tbody>
                      {group.employees.map((employee) => (
                        <tr
                          key={`${employee.fullName}-${employee.internalNumber}`}
                        >
                          <td className="person-details">
                            <div className="full-name">{employee.fullName}</div>
                            <div className="position">{employee.position}</div>
                          </td>
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

  const renderCabinetTable = (items: Cabinet[]) => (
    <div className="table-container">
      <table>
        <thead>
          <tr>
            <th>Город</th>
            <th>Адрес</th>
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
          {searchQuery
            ? "По вашему запросу ничего не найдено."
            : "Нет данных для отображения."}
        </p>
      )}
    </div>
  );

  return (
    <div className="handbook-container">
      <h1>Корпоративный Справочник</h1>
      <div className="controls-panel">
        <div className="search-wrapper">
          <input
            ref={searchInputRef}
            type="text"
            placeholder="Поиск по всем полям..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="search-input"
          />
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
      <div className="status-bar">
        {error && <span className="error-message">{error}</span>}
        {lastUpdated && (
          <span className="last-update">
            Обновлено: {format(new Date(lastUpdated), "dd.MM.yyyy HH:mm:ss")}
          </span>
        )}
      </div>
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
      <div className="tab-content">
        {activeTab === "office" && renderOfficeTable(filteredOffice)}
        {activeTab === "cabinets" && renderCabinetTable(filteredCabinets)}
      </div>
    </div>
  );
};

export default Handbook;
