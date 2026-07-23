<p align="center">
  <img src="assets/banner.png" alt="OpenMobileProxy Banner" width="100%" style="border-radius: 12px;" />
</p>

# 📱 OpenMobileProxy

> **Open-Source Mobile Proxy System** — превратите любой смартфон Android в приватный мобильный прокси-сервер с поддержкой SOCKS5, удаленной смены IP и удобной веб-панелью управления.

[![Node.js](https://img.shields.io/badge/Node.js-v18%2B-green.svg)](https://nodejs.org)
[![Kotlin](https://img.shields.io/badge/Kotlin-Android-blue.svg)](https://kotlinlang.org)
[![React](https://img.shields.io/badge/React-v18-cyan.svg)](https://react.dev)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

<p align="center">
  <a href="https://github.com/makssest06-alt/open-mobile-proxy/raw/main/OpenMobileProxy.apk">
    <img src="https://img.shields.io/badge/📥_Скачать_готовый_APK-OpenMobileProxy.apk-2ea44f?style=for-the-badge&logo=android" alt="Download APK" />
  </a>
</p>

---

## 🌟 Возможности системы

- ⚡ **Высокоскоростной SOCKS5 / HTTP прокси**: Мультиплексирование TCP-соединений через WebSocket напрямую с мобильным устройством.
- 🔄 **Индивидуальная & Автоматическая Ротация IP**: Переключение режима «В самолете» (Airplane Mode) по API, нажатию одной кнопки в панели или персональному расписанию (таймеру).
- 📊 **Веб-панель управления**:
  - Мониторинг статуса онлайн/офлайн устройств, операторов связи, заряда батареи и температуры.
  - Встроенный реальный замер скорости скачивания и отдачи (SpeedTest).
  - Живой терминал системных и сетевых логов сервера.
  - Генератор готовых примеров кода для интеграции (cURL, Python `requests`, Node.js `axios`).
- 🔒 **Безопасность**: JWT-авторизация веб-панели, уникальные ключи устройств (API Key) и защищенный доступ к прокси-портам.
- 🚀 **Деплой в 1 клик на любой VPS**: Автоматический скрипт установки через SSH на любой виртуальный сервер Ubuntu/Debian.

---

## 🏗 Архитектура решения

```
┌────────────────────────────────┐         WebSocket (Encrypted)         ┌────────────────────────────────┐
│      Android Мобильный Клиент  │ ◄───────────────────────────────────► │      VPS Сервер Node.js        │
│  (SOCKS5 Relay + Accessibility)│                                       │ (TCP Proxy Server + Web Panel) │
└────────────────────────────────┘                                       └────────────────────────────────┘
                                                                                         ▲
                                                                                         │ SOCKS5 (port 10001+)
                                                                                         ▼
                                                                         ┌────────────────────────────────┐
                                                                         │       Клиентский Софт / Скрипт │
                                                                         └────────────────────────────────┘
```

---

## 📱 Быстрая установка на Android (Без сборки исходников)

Больше не нужно собирать проект в Android Studio! Готовый скомпилированный APK уже находится в репозитории:

1. **Скачайте готовый APK**:
   👉 **[Скачать OpenMobileProxy.apk](https://github.com/makssest06-alt/open-mobile-proxy/raw/main/OpenMobileProxy.apk)** на ваш смартфон.
2. **Установите приложение**:
   - Нажмите на скачанный файл и подтвердите установку (разрешите установку из неизвестных источников при запросе системы).
3. **Подключите к вашему VPS**:
   - Откройте приложение **OpenMobileProxy**.
   - Укажите URL вашего VPS (например: `http://217.114.8.131:3000`).
   - Нажмите **Запустить сервис**.
4. *(Опционально для авто-смены IP)*:
   - Включите разрешение для **Службы специальных возможностей (Accessibility Service)**, когда приложение запросит его.

---

## 🚀 Быстрый старт (Установка Сервера на VPS)

### Вариант A. Автоматический деплой на VPS через SSH (Рекомендуется)

1. Клонируйте репозиторий на ваш ПК:
   ```bash
   git clone https://github.com/makssest06-alt/open-mobile-proxy.git
   cd open-mobile-proxy
   ```

2. Укажите IP-адрес и SSH-пароль вашего VPS в файле `.env`:
   ```env
   VPS_HOST=your_vps_ip
   VPS_USER=root
   VPS_PASS=your_vps_ssh_password
   ```

3. Запустите автоматический деплой:
   ```bash
   npx tsx deploy.ts
   ```
Скрипт автоматически настроит фаервол, загрузит проект, установит зависимости и запустит сервис под управлением `PM2`.

---

### Вариант B. Локальный запуск на Node.js

```bash
npm install
cp .env.example .env
npm run dev
```
Веб-панель будет доступна по адресу `http://localhost:3000` (логин: `admin`, пароль: `admin`).

---

## 💻 Пример использования Прокси

После подключения телефона в панели управления появится точка доступа SOCKS5, например `admin:pass123@217.114.8.131:24759`.

### cURL
```bash
curl --socks5-hostname admin:pass123@217.114.8.131:24759 https://ifconfig.me
```

### Python
```python
import requests

proxies = {
    'http': 'socks5h://admin:pass123@217.114.8.131:24759',
    'https': 'socks5h://admin:pass123@217.114.8.131:24759'
}

response = requests.get('https://ifconfig.me', proxies=proxies)
print("Текущий Мобильный IP:", response.text)
```

### Ротация IP по URL (API Link)
Вы можете принудительно запросить ротацию IP смартфона простым HTTP GET запросом из любых ваших скриптов:
```bash
curl http://217.114.8.131:3000/api/change-ip/PHONE_DEVICE_ID
```

---

## 🛡 Лицензия

Распространяется под лицензией **MIT**. Свободно для личного и коммерческого использования.
