/**
 * ScrollDepthTracker v1.0
 * Универсальный скрипт отслеживания процента просмотра страницы
 *
 * Алгоритм:
 *   1. Проверяет, находится ли текущая страница в whitelist (pages)
 *   2. Восстанавливает сработавшие цели из localStorage (без повторных отправок)
 *   3. Определяет полную высоту документа (scrollHeight)
 *   4. Разбивает высоту на равные части (по умолчанию 5: 20%, 40%, 60%, 80%, 100%)
 *   5. При каждой прокрутке проверяет, достигла ли нижняя граница viewport порога
 *   6. Как только достигнуто — срабатывает цель (callback) и сохраняется в localStorage
 *
 * Пример:
 *   Высота страницы: 1500px
 *   Пороги: 300, 600, 900, 1200, 1500
 *   Пользователь прокрутил до 620px
 *   scrollBottom = 620 + viewportHeight(800) = 1420
 *   → Сработали цели: 20% (300), 40% (600), 60% (900), 80% (1200)
 *   → 100% (1500) ещё не достигнут
 */

class ScrollDepthTracker {
  /**
   * @param {Object} options - Настройки
   * @param {number[]}   [options.percentages=[20,40,60,80,100]] - Пороги в %
   * @param {string[]}   [options.pages=['/']] - Список путей, на которых работает трекер.
   *   GET-параметры обрезаются при сравнении: "/" и "/?clear_cache=Y" считаются одной страницей.
   * @param {string}     [options.storageKey] - Ключ localStorage. По умолчанию: "sdt_<pathname>"
   * @param {number}     [options.ttl=0] - Срок жизни данных в localStorage (секунды). 0 = без ограничения.
   *   Примеры: 3600 = 1 час, 86400 = 1 день, 604800 = 1 неделя.
   * @param {Function}   [options.onGoal=null] - Callback: (percent, pixelThreshold) => {}
   * @param {Function}   [options.onAllGoals=null] - Callback при достижении всех целей
   * @param {number}     [options.throttleDelay=100] - Задержка троттлинга scroll (ms)
   * @param {boolean}    [options.debug=false] - Логи в консоль + визуальная панель
   * @param {boolean}    [options.checkOnLoad=true] - Проверять пороги при загрузке
   */
  constructor(options = {}) {
    // --- Настройки ---
    this.percentages = options.percentages || [20, 40, 60, 80, 100];
    this.pages = Array.isArray(options.pages) ? options.pages : ["/"];
    this.onGoal = typeof options.onGoal === "function" ? options.onGoal : null;
    this.onAllGoals =
      typeof options.onAllGoals === "function" ? options.onAllGoals : null;
    this.ttl = typeof options.ttl === "number" ? options.ttl : 0;
    this.throttleDelay = options.throttleDelay || 100;
    this.debug = options.debug || false;
    this.checkOnLoad =
      options.checkOnLoad !== undefined ? options.checkOnLoad : true;

    // --- Ключ localStorage ---
    const currentPath = location.pathname.replace(/\/+$/, "") || "/";
    this._storageKey = options.storageKey || "sdt_" + currentPath;

    // --- Проверка: текущая страница в whitelist? ---
    this._currentPath = currentPath;
    if (!this._isAllowedPage()) {
      if (this.debug) {
        console.log(
          `[ScrollDepthTracker] Страница "${this._currentPath}" не входит в pages: [${this.pages.join(", ")}] — трекинг отключён`,
        );
      }
      this._disabled = true;
      return;
    }

    // --- Внутреннее состояние ---
    this._disabled = false;
    this._triggered = new Set();
    this._throttleTimer = null;
    this._debounceTimer = null;
    this._scrollHandler = this._onScroll.bind(this);
    this._resizeHandler = this._debouncedCheck.bind(this);
    this._allGoalsFired = false;
    this._sortedPercentages = [...this.percentages].sort((a, b) => a - b);

    // --- Восстановление из localStorage ---
    this._restoreFromStorage();

    // --- Старт ---
    this._init();
  }

  // ============================
  // Проверка страницы
  // ============================

  /**
   * Сравнивает текущий path с whitelist.
   * GET-параметры, хеш и trailing slash не учитываются.
   */
  _isAllowedPage() {
    const current = this._currentPath;
    if (this.pages.length === 0) {
      return true;
    }
    return this.pages.some((page) => {
      const p = page.replace(/\/+$/, "") || "/";
      return current === p;
    });
  }

  // ============================
  // localStorage
  // ============================

  _restoreFromStorage() {
    try {
      const raw = localStorage.getItem(this._storageKey);
      if (!raw) return;

      const parsed = JSON.parse(raw);

      // Формат: { ts: unix_timestamp, g: [20, 40, ...] }
      // Совместимость со старым форматом: [20, 40, ...]
      let goals;
      let timestamp;

      if (Array.isArray(parsed)) {
        // Старый формат без TTL
        goals = parsed;
        timestamp = 0;
      } else if (
        parsed &&
        typeof parsed.ts === "number" &&
        Array.isArray(parsed.g)
      ) {
        goals = parsed.g;
        timestamp = parsed.ts;
      } else {
        return;
      }

      // Проверяем TTL
      if (this.ttl > 0 && timestamp > 0) {
        const age = Math.floor(Date.now() / 1000) - timestamp;
        if (age > this.ttl) {
          this._log(
            `Данные в localStorage устарели (возраст: ${age}с, ttl: ${this.ttl}с) — сброс`,
          );
          this._clearStorage();
          return;
        }
      }

      // Берём только те, которые есть в текущем массиве порогов
      goals.forEach((p) => {
        if (this._sortedPercentages.includes(p)) {
          this._triggered.add(p);
        }
      });
    } catch (e) {
      // Corrupted data — ignore
    }

    // Если после восстановления все цели уже достигнуты
    if (this._triggered.size === this._sortedPercentages.length) {
      this._allGoalsFired = true;
    }
  }

  _saveToStorage() {
    try {
      const data = {
        ts: Math.floor(Date.now() / 1000),
        g: [...this._triggered],
      };
      localStorage.setItem(this._storageKey, JSON.stringify(data));
    } catch (e) {
      // Quota exceeded или private mode — ignore
    }
  }

  _clearStorage() {
    try {
      localStorage.removeItem(this._storageKey);
    } catch (e) {
      // ignore
    }
  }

  // ============================
  // Инициализация
  // ============================

  _init() {
    // Если всё уже достигнуто — не подписываемся на события
    if (this._allGoalsFired) {
      this._log("Все цели были достигнуты ранее — слушатели не установлены");
      if (this.debug) this._createDebugPanel();
      return;
    }

    window.addEventListener("scroll", this._scrollHandler, { passive: true });
    window.addEventListener("resize", this._resizeHandler, { passive: true });

    // Проверяем при загрузке
    if (this.checkOnLoad) {
      if (document.readyState === "complete") {
        this._check();
      } else {
        window.addEventListener("load", () => this._check(), { once: true });
      }
    }

    if (this.debug) this._createDebugPanel();
  }

  // ============================
  // Измерения
  // ============================

  _getPageHeight() {
    return Math.max(
      document.body.scrollHeight,
      document.documentElement.scrollHeight,
      document.body.offsetHeight,
      document.documentElement.offsetHeight,
    );
  }

  _getViewportHeight() {
    return (
      window.innerHeight ||
      document.documentElement.clientHeight ||
      document.body.clientHeight
    );
  }

  _getScrollTop() {
    return (
      window.pageYOffset ||
      document.documentElement.scrollTop ||
      document.body.scrollTop ||
      0
    );
  }

  // ============================
  // Scroll / Resize
  // ============================

  _onScroll() {
    if (this._allGoalsFired) return;
    if (this._throttleTimer) return;

    this._throttleTimer = setTimeout(() => {
      this._throttleTimer = null;
      this._check();
    }, this.throttleDelay);
  }

  _debouncedCheck() {
    if (this._allGoalsFired) return;

    clearTimeout(this._debounceTimer);
    this._debounceTimer = setTimeout(() => {
      this._check();
    }, 250);
  }

  // ============================
  // Основная проверка
  // ============================

  _check() {
    const pageHeight = this._getPageHeight();
    const viewportHeight = this._getViewportHeight();
    const scrollTop = this._getScrollTop();
    const scrollBottom = scrollTop + viewportHeight;

    if (pageHeight <= 0) return;

    for (const percent of this._sortedPercentages) {
      if (this._triggered.has(percent)) continue;

      const pixelThreshold = Math.round((pageHeight * percent) / 100);

      if (scrollBottom >= pixelThreshold) {
        this._triggered.add(percent);
        this._saveToStorage();

        this._log(
          `Цель достигнута: ${percent}% (порог: ${pixelThreshold}px, scrollBottom: ${scrollBottom}px)`,
        );

        if (this.debug) this._activateDebugGoal(percent);

        if (this.onGoal) {
          try {
            this.onGoal(percent, pixelThreshold);
          } catch (e) {
            console.error("[ScrollDepthTracker] Ошибка в onGoal callback:", e);
          }
        }
      }
    }

    if (
      !this._allGoalsFired &&
      this._triggered.size === this._sortedPercentages.length
    ) {
      this._allGoalsFired = true;

      const allTriggered = [...this._triggered].sort((a, b) => a - b);
      this._log(`Все цели достигнуты: ${allTriggered.join("% → ")}%`);

      if (this.onAllGoals) {
        try {
          this.onAllGoals(allTriggered);
        } catch (e) {
          console.error(
            "[ScrollDepthTracker] Ошибка в onAllGoals callback:",
            e,
          );
        }
      }

      this._detachListeners();
    }
  }

  // ============================
  // Логирование
  // ============================

  _log(message) {
    if (this.debug) {
      console.log(`[ScrollDepthTracker] ${message}`);
    }
  }

  // ============================
  // Debug-панель
  // ============================

  _createDebugPanel() {
    // Удаляем старую панель если есть (при re-init)
    const existing = document.getElementById("sdt-panel");
    if (existing) existing.remove();
    const existingBtn = document.getElementById("sdt-toggle");
    if (existingBtn) existingBtn.remove();

    // --- Кнопка-тоггл (всегда видна) ---
    const toggle = document.createElement("div");
    toggle.id = "sdt-toggle";
    toggle.style.cssText = [
      "position:fixed",
      "top:12px",
      "right:12px",
      "width:28px",
      "height:28px",
      "border-radius:6px",
      "background:#fff",
      "box-shadow:0 2px 8px rgba(0,0,0,.12)",
      "z-index:100000",
      "display:flex",
      "align-items:center",
      "justify-content:center",
      "cursor:pointer",
      "user-select:none",
      "font-family:-apple-system,BlinkMacSystemFont,system-ui,sans-serif",
      "font-size:13px",
      "line-height:1",
      "color:#64748b",
      "transition:background .2s,color .2s,box-shadow .2s",
    ].join(";");
    toggle.textContent = "S";

    // --- Панель (содержимое) ---
    const panel = document.createElement("div");
    panel.id = "sdt-panel";
    panel.style.cssText = [
      "position:fixed",
      "top:48px",
      "right:12px",
      "background:#fff",
      "border-radius:8px",
      "padding:12px 14px",
      "box-shadow:0 2px 12px rgba(0,0,0,.1)",
      "z-index:99999",
      "font-family:-apple-system,BlinkMacSystemFont,system-ui,sans-serif",
      "font-size:12px",
      "line-height:1",
      "min-width:150px",
      "user-select:none",
      "transition:opacity .2s,transform .2s",
      "opacity:1",
      "transform:translateY(0)",
    ].join(";");

    // Заголовок
    const title = document.createElement("div");
    title.textContent = "Scroll Depth";
    title.style.cssText =
      "font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px";
    panel.appendChild(title);

    // Строки целей
    this._sortedPercentages.forEach((pct) => {
      const row = document.createElement("div");
      row.style.cssText =
        "display:flex;align-items:center;padding:3px 0;gap:6px";

      const dot = document.createElement("div");
      dot.id = `sdt-dot-${pct}`;
      dot.style.cssText = [
        "width:8px",
        "height:8px",
        "border-radius:50%",
        "background:#e2e8f0",
        "transition:background .3s,box-shadow .3s",
        "flex-shrink:0",
      ].join(";");

      const label = document.createElement("span");
      label.id = `sdt-label-${pct}`;
      label.textContent = `${pct}%`;
      label.style.cssText = "color:#94a3b8;transition:color .3s;font-size:12px";

      row.appendChild(dot);
      row.appendChild(label);
      panel.appendChild(row);
    });

    // Разделитель
    const sep = document.createElement("div");
    sep.style.cssText = "border-top:1px solid #f1f5f9;margin:6px 0";
    panel.appendChild(sep);

    // Инфо-строка
    const info = document.createElement("div");
    info.id = "sdt-info";
    info.style.cssText =
      "font-size:10px;color:#94a3b8;font-family:monospace;line-height:1.5";
    panel.appendChild(info);

    // Счётчик на кнопке
    const badge = document.createElement("div");
    badge.id = "sdt-badge";
    badge.style.cssText = [
      "position:absolute",
      "top:-4px",
      "right:-4px",
      "min-width:16px",
      "height:16px",
      "border-radius:8px",
      "background:#4f46e5",
      "color:#fff",
      "font-size:9px",
      "font-weight:700",
      "display:flex",
      "align-items:center",
      "justify-content:center",
      "padding:0 4px",
      "line-height:1",
      "transition:background .3s",
    ].join(";");
    toggle.appendChild(badge);

    // Логика сворачивания
    let collapsed = false;

    toggle.addEventListener("click", () => {
      collapsed = !collapsed;
      if (collapsed) {
        panel.style.opacity = "0";
        panel.style.transform = "translateY(-8px)";
        panel.style.pointerEvents = "none";
        toggle.style.background = "#f1f5f9";
      } else {
        panel.style.opacity = "1";
        panel.style.transform = "translateY(0)";
        panel.style.pointerEvents = "auto";
        toggle.style.background = "#fff";
      }
    });

    document.body.appendChild(panel);
    document.body.appendChild(toggle);

    // Подсвечиваем уже достигнутые
    this._triggered.forEach((pct) => this._activateDebugGoal(pct));
    this._updateDebugInfo();
  }

  _activateDebugGoal(percent) {
    const dot = document.getElementById(`sdt-dot-${percent}`);
    const label = document.getElementById(`sdt-label-${percent}`);
    if (dot) {
      dot.style.background = "#22c55e";
      dot.style.boxShadow = "0 0 4px rgba(34,197,94,.35)";
    }
    if (label) {
      label.style.color = "#1e293b";
      label.style.fontWeight = "600";
    }

    this._updateDebugInfo();
  }

  _updateDebugInfo() {
    const info = document.getElementById("sdt-info");
    const badge = document.getElementById("sdt-badge");
    if (!info) return;

    const restored = [...this._triggered].sort((a, b) => a - b);
    const ttlText = this.ttl > 0 ? this.ttl + "s" : "inf";
    info.innerHTML =
      `path: ${this._currentPath}<br>` +
      `ttl: ${ttlText}<br>` +
      `done: [${restored.join(", ")}%]`;

    if (badge) {
      badge.textContent = this._triggered.size;
      if (this._allGoalsFired) {
        badge.style.background = "#22c55e";
      }
    }
  }

  // ============================
  // Управление
  // ============================

  _detachListeners() {
    window.removeEventListener("scroll", this._scrollHandler);
    window.removeEventListener("resize", this._resizeHandler);
  }

  /**
   * Возвращает массив уже достигнутых процентов
   * @returns {number[]}
   */
  getTriggered() {
    return [...this._triggered].sort((a, b) => a - b);
  }

  /**
   * Сбрасывает все достижения и перезапускает отслеживание
   */
  reset() {
    if (this._disabled) return;

    this._triggered.clear();
    this._allGoalsFired = false;
    this._clearStorage();
    this._check();

    window.removeEventListener("scroll", this._scrollHandler);
    window.removeEventListener("resize", this._resizeHandler);
    window.addEventListener("scroll", this._scrollHandler, { passive: true });
    window.addEventListener("resize", this._resizeHandler, { passive: true });

    if (this.debug) this._createDebugPanel();

    this._log("Отслеживание сброшено и перезапущено");
  }

  /**
   * Полная остановка и очистка
   */
  destroy() {
    if (this._disabled) return;

    this._detachListeners();
    clearTimeout(this._throttleTimer);
    clearTimeout(this._debounceTimer);
    this._triggered.clear();
    this._allGoalsFired = false;

    const panel = document.getElementById("sdt-panel");
    if (panel) panel.remove();
    const toggleBtn = document.getElementById("sdt-toggle");
    if (toggleBtn) toggleBtn.remove();

    this._log("Отслеживание остановлено");
  }

  /**
   * Обновляет настройки порогов на лету
   * @param {number[]} newPercentages
   */
  updatePercentages(newPercentages) {
    if (this._disabled) return;

    this.percentages = newPercentages;
    this._sortedPercentages = [...newPercentages].sort((a, b) => a - b);
    this._triggered.clear();
    this._allGoalsFired = false;
    this._clearStorage();
    this._check();

    if (this.debug) this._createDebugPanel();

    this._log(`Пороги обновлены: ${newPercentages.join("% → ")}%`);
  }
}
