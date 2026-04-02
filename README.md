# ScrollDepthTracker

Нативный JS-скрипт для отслеживания глубины просмотра страницы. Разбивает страницу на равные части и срабатывает при достижении каждой границы.

## Как работает

```
Высота страницы: 1500px, viewport: 800px

Пороги:  300px   600px   900px   1200px   1500px
          20%     40%     60%      80%      100%
           ✓       ✓       ✓        ✓        ✓

scrollBottom = scrollTop + viewportHeight
как только scrollBottom >= порога → цель сработала
```

Сработавшие цели сохраняются в `localStorage` — при перезагрузке или повторном визите они не отправляются повторно.

## Подключение

```html
<script src="scroll-depth-tracker.js"></script>
<script>
  new ScrollDepthTracker({
    debug: true,
    onGoal(percent, pixelThreshold) {
      console.log(`Просмотр ${percent}% (порог: ${pixelThreshold}px)`);
    }
  });
</script>
```

## Опции

| Параметр | Тип | По умолчанию | Описание |
|---|---|---|---|
| `percentages` | `number[]` | `[20, 40, 60, 80, 100]` | Пороги в % |
| `pages` | `string[]` | `['/']` | Список путей, на которых работает трекер. GET-параметры обрезаются при сравнении |
| `storageKey` | `string` | `'sdt_/'` | Ключ localStorage. Автогенерируется из pathname |
| `ttl` | `number` | `0` | Срок жизни данных в localStorage (секунды). `0` = навсегда. Примеры: `3600` = 1 час, `86400` = 1 день, `604800` = 1 неделя |
| `onGoal` | `Function` | `null` | Callback: `(percent, pixelThreshold) => {}` |
| `onAllGoals` | `Function` | `null` | Callback при достижении всех целей |
| `throttleDelay` | `number` | `100` | Задержка троттлинга scroll, ms |
| `debug` | `boolean` | `false` | Логи в консоль + визуальная панель в углу экрана |
| `checkOnLoad` | `boolean` | `true` | Проверять пороги при загрузке страницы |

## Pages — ограничение по страницам

По умолчанию трекер работает только на `/`.

```js
// Только главная
new ScrollDepthTracker({ pages: ['/'] });

// Все страницы (работает как один трекер по всем страницам, каждую отдельно не проверяет)
new ScrollDepthTracker({ pages: [] });
```

Сравнение идёт по `location.pathname` без GET-параметров. То есть `/` и `/?clear_cache=Y` — одна и та же страница.

## TTL — срок жизни данных

По умолчанию сработавшие цели сохраняются навсегда. Через `ttl` можно задать ограничение — по истечении срока данные очищаются и цели снова будут отправляться:

```js
// Без ограничения (навсегда) — по умолчанию
new ScrollDepthTracker({ ttl: 0 });

// В течение 1 дня
new ScrollDepthTracker({ ttl: 86400 });
```

## Методы

```js
const tracker = new ScrollDepthTracker({ ... });

tracker.getTriggered();          // [20, 40, 60] — достигнутые цели
tracker.reset();                 // сбросить localStorage и перезапустить
tracker.destroy();               // полностью остановить
tracker.updatePercentages([25, 50, 75, 100]); // сменить пороги на лету
```

## Примеры

### Яндекс.Метрика

```js
new ScrollDepthTracker({
  onGoal(percent) {
    ym(XXXXXXXX, 'reachGoal', 'scroll_' + percent);
  }
});
// Цели в Метрике: scroll_20, scroll_40, scroll_60, scroll_80, scroll_100
```

### Отправка на свой сервер

```js
new ScrollDepthTracker({
  onGoal(percent) {
    const data = new FormData();
    data.append('percent', percent);
    data.append('url', window.location.href);
    navigator.sendBeacon('/api/scroll-depth', data);
  }
});
```

### Свой набор порогов

```js
new ScrollDepthTracker({
  percentages: [10, 25, 50, 75, 100],
  onGoal(percent) { /* ... */ }
});
```

## Debug

При `debug: true` в правом верхнем углу появляется:

- **Кнопка-тоггл** — маленький квадрат с буквой «S» и счётчиком достигнутых целей (фиолетовый = в процессе, зелёный = все достигнуты). Клик сворачивает/разворачивает панель.
- **Панель** — список целей (серый/зелёный), текущий путь, TTL, достигнутые цели.

Панель генерируется автоматически из массива `percentages` — если задать `[10, 50, 100]`, в панели будет 3 пункта.

## Файлы

| Файл | Описание |
|---|---|
| `scroll-depth-tracker.js` | Основной скрипт |
| `scroll-depth-demo.html` | Демо-лендинг для тестирования |
