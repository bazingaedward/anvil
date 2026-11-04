# Anvil 应用图标

## 问题与方案

默认 Electron 图标无法代表产品。采用用户选定的抽象开放几何标志：黑色圆角底、米白切面与向右上的动势，不使用铁砧、代码括号或循环箭头。

原图由内置 imagegen 生成，保存于 `assets/anvil-source.png`；提示词与来源记录在 `assets/README.md`。使用 `npm run icons:build` 在 macOS 生成保留透明边缘的 PNG、ICNS 和多尺寸 ICO。

开发模式通过 Electron 设置窗口及 Dock 图标；安装包使用平台图标配置。PNG 随应用资源打包，确保安装后不依赖源码目录。图标修改不影响对话、模型和权限逻辑。

验证图标尺寸、透明通道、ICO/ICNS 格式，以及类型检查和构建；Windows 图标生成但不在本机验证系统显示。
