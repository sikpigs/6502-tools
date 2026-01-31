# 6502 Tools

**6502 Tools** is a Visual Studio Code extension that adds convenient build and flash
controls for 6502 / 65C02 projects using `ca65` / `ld65` and the `minipro` programmer.

It provides:
- Status bar buttons for **Build**, **Flash**, and **Build + Flash**
- A command to **install or update recommended VS Code tasks**
- EEPROM chip selection using `minipro -l`
- Safe, comment-preserving updates to `.vscode/tasks.json`

This extension is designed for hobbyist and retro-computing workflows and does **not**
require Unreal, Arduino, or PlatformIO.

---

## ✨ Features

- 🔘 Status bar buttons:
  - **Build**
  - **Flash**
  - **Build + Flash**
- 🧩 Automatically installs / updates build & flash tasks
- 💾 EEPROM device selection via `minipro`
- 🔒 Optional write-protect disable (`-uP`)
- 📝 Preserves existing comments and formatting in `tasks.json`
- 🧠 Remembers last selected EEPROM per workspace

---

## 📦 Requirements

You must have the following tools installed and available on your `PATH`:

- **CMake**
- **cc65 toolchain** (`ca65`, `ld65`)
- **minipro** (TL866 / XGecu command-line programmer)

Verify with:

```sh
cmake --version
ca65 --version
ld65 --version
minipro --version
```