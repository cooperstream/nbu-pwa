# NBU PWA

## Архітектура модулів

### Точки входу
- `index.html` — тільки DOM-каркас + підключення CSS/JS.
- `src/app.js` — головна ініціалізація, wiring подій і запуск завантаження даних.

### JS-модулі
- `src/domain/rates.js` — доменна логіка: курси, конвертація, форматування, метадані валют.
- `src/services/nbu-api.js` — робота з API НБУ (`nbuFetch`, `fetchHistoryPoint`, URL-збірка, історія/поточні дані).
- `src/services/cache.js` — кеш (`cGet`, `cSet`), TTL і ключі кешу.
- `src/ui/cards.js` — UI карток (`renderCards`, `toggleCard`, `switchPeriod`).
- `src/ui/converter.js` — стан і події конвертера, кастомний dropdown.
- `src/ui/charts.js` — рендер графіків (`renderChart`), sparkline, lifecycle chart instances.

### CSS-структура
- `styles/main.css` — глобальні змінні, базовий layout, reset, загальні utility-правила.
- `styles/components/header.css` — стилі header / toolbar / base switch.
- `styles/components/cards.css` — стилі карток валют.
- `styles/components/converter.css` — стилі конвертера й custom listbox.
- `styles/components/chart.css` — стилі графіка/loader/tooltip.
