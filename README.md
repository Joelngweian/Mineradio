# Mineradio

![Mineradio](./docs/assets/readme/cinema-beat-smoke.png)

Mineradio 是一款 Windows 桌面沉浸式音乐播放器，把天气电台、搜索播放、歌词舞台、粒子视觉和 3D 歌单架组合成一个更接近现场感的私人音乐空间。

## 下载安装

前往本仓库的 [Releases](https://github.com/Joelngweian/Mineradio/releases) 页面，下载最新的 `Mineradio-<版本>-Setup.exe`，下载后直接运行安装即可。

安装时只需下载并运行 `Mineradio-<版本>-Setup.exe`。不要下载 `Source code`、`.blockmap`，也不要把 `win-unpacked` 目录当成正式安装包。

## 下载或安装被拦截怎么办

小众 Electron 桌面软件、未签名安装包有时会被浏览器、Windows Defender 或 SmartScreen 提示风险。请先确认安装包来自本仓库 Releases 官方入口，文件名是 `Mineradio-<版本>-Setup.exe`。

1. 浏览器下载栏提示风险时，打开下载列表，点这条下载右侧的 `...` 三个点，选择 `保留` / `仍要保留` 后继续保留。
2. Windows SmartScreen 弹出蓝色拦截窗口时，点 `更多信息`，再点 `仍要运行`。
3. 如果杀毒软件明确显示木马、高危或已经隔离，不要强行运行；删除该文件后从本仓库 Releases 重新下载，仍然异常请带截图反馈。

## 核心特性

- Open-Meteo 天气电台，根据当前位置、城市和天气 mood 生成更合适的播放队列
- 首页氛围时钟 Now 屏，配合天气电台、每日推荐、私人电台、继续听、听歌画像和我的歌单入口
- Wallpaper 银河首页背景，未播放状态保持干净的星河氛围
- 播放后切换到播放态视觉，歌词舞台与粒子舞台同步工作
- 基于节奏的电影镜头视觉系统，面向长播客和 DJ 曲目的专属视觉模式
- 歌词舞台、自定义歌词、歌词位置与视觉控制
- 自定义专辑封面上传与裁剪
- 右键唤起 3D 歌单架，支持歌单队列浏览
- YouTube Music 原生搜索、歌单、歌词与音频流接入（Google 账号授权）
- Spotify 官方 OAuth 账号、歌单与搜索元数据接入，播放自动匹配 YouTube Music 音源
- GitHub Releases 更新检测与下载入口

## 使用说明

Windows 用户可以在本仓库 Releases 中下载安装包。正式分发以 `Mineradio-<版本>-Setup.exe` 为准，不建议直接下载 `win-unpacked` 目录作为正式分发包。安装包会创建桌面快捷方式；直接运行打包版 `Mineradio.exe` 时，应用也会在首次启动时补创建桌面快捷方式。

## 开发运行

```powershell
npm install        # 首次或依赖变更后
npm start          # 启动应用（electron .）
npm run build:win  # 生成 Windows NSIS 安装包 -> dist/
```

桌面版入口由 Electron 主进程加载本地服务。`npm run build:win` 会生成 Windows NSIS 安装包，产物位于 `dist/`。

## 更新机制

Mineradio 会请求 GitHub Releases 检测新版本。远端版本高于本地版本时，应用内更新入口会展示 Release 内容、下载安装包到本机用户数据目录，并通过系统打开安装包。

本地验证更新链路时，可以通过 `MINERADIO_UPDATE_MANIFEST` 指向一个本地 manifest JSON 或 HTTP 地址来模拟线上 Release。

## 第三方音乐平台说明

Mineradio 不是 YouTube Music（Google）或 Spotify 的官方客户端，也不隶属于任何音乐平台。

项目中的第三方平台接入仅用于个人学习、本地客户端体验和用户自有账号的播放辅助。请遵守对应平台的用户协议、版权规则和会员权益规则。项目不会提供绕过付费、绕过会员、破解音质或重新分发音乐内容的能力。

## 用户数据与隐私

登录 Cookie、Spotify OAuth 令牌、搜索历史、自定义封面、自定义歌词、节奏分析缓存等数据只应保存在本机用户数据目录或浏览器本地存储中，不应提交到仓库。

更多说明见 [PRIVACY.md](./PRIVACY.md)。

## 致谢与来源

本项目基于开源项目 [XxHuberrr/Mineradio](https://github.com/XxHuberrr/Mineradio)（GPL-3.0）二次开发与维护，在此感谢原作者及其贡献者的工作。

## 版权与授权

本仓库为 Mineradio 的派生版本，继续采用 GPL-3.0 授权。详见 [LICENSE](./LICENSE)。

原始项目版权归其各自作者所有；本仓库在 GPL-3.0 条款下进行修改与再分发。第三方依赖和第三方服务分别遵循其各自授权与服务条款。
