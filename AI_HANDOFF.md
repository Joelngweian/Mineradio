# Mineradio AI Handoff

这个文件是给后续接管本工作区的 AI 看的。每次完成一个任务后，都要更新本文件的「工作日志」和「未完成事项」，让下一位接手者能快速知道用户偏好、当前状态和最近做过什么。

## 当前权威入口（2026-06-24）

- 当前真实代码/Git 仓库仍是 `E:\桌面\播放器软件\Mineradio\resources\app`。
- 当前版本是 `v1.1.0` 纯净安装发布线；本轮已从当前可信源码重新生成并发布 `dist/Mineradio-1.1.0-Setup.exe`。
- GitHub 仓库已公开：`https://github.com/XxHuberrr/Mineradio`
- `v1.1.0` Release：`https://github.com/XxHuberrr/Mineradio/releases/tag/v1.1.0`
- GitHub `/releases/latest` 仍返回 `v1.0.10`，这是刻意设置，避免旧版软件内更新到 1.1.0。
- `v1.0.10` 及更早旧安装包不再信任，需要在 GitHub Release/README/SECURITY 中标记隔离。
- `v1.1.0` 不提供从 `v1.0.10` 的软件内本地更新，不上传 `latest.yml`，不生成 `v1.0.10 -> v1.1.0` 快速补丁。
- 新对话优先读 `AGENTS.md`、`docs/PROJECT_MEMORY.md`、`docs/HANDOFF_NEXT_CHAT.md`；涉及安全重建或发布时再读 `docs/SECURITY_REBUILD_2026-06-24.md`。本文件下面包含较早历史记录，不能覆盖上述文件的当前结论。

## 用户偏好

- 默认用中文沟通，语气直接、清楚、偏实干。
- 用户希望你主动完成任务，不要只给方案。能本地验证就本地验证。
- 除非用户明确要求“上传 GitHub / 推送 / push / 发布到 Release”，否则不要直接上传或推送到 GitHub；本地提交也要在最终说明里讲清楚。
- 用户很在意视觉质感，尤其讨厌“默认白框”“太素”“没设计感”。Mineradio 视觉方向偏黑色、玻璃、舞台、音乐可视化。
- 做网页、软件界面、安装器时，要优先考虑第一次打开的新用户是否知道软件是干什么的。
- 发布软件时，不能只上传源码。GitHub Release 通常要包含可运行安装包 exe；但 `v1.1.0` 安全发布例外，不上传 `latest.yml`，避免旧版软件内更新直接拉取。
- 安装器默认安装目录优先使用 `D:\Mineradio`，并创建桌面快捷方式。
- 更新逻辑优先轻量快速补丁；完整安装包作为兜底。
- 搜索结果要尽量优先原唱/官方版本，不希望翻唱排在原唱前面。
- 感谢名单曾确认：`emily、小天才e宝、应春日、锋将军、軌跡、林中、骊、风痕、花椰菜🥦`。

## 工作区地图

- `server.js`：本地 API、网易云代理、搜索、首页数据、更新检查、完整安装包下载、快速补丁应用。
- `public/index.html`：主界面和大部分前端逻辑，体量很大，修改前先用 `rg` 定位。
- `desktop/`：Electron 主进程、preload、窗口和系统集成。
- `build/`：应用图标、NSIS 安装器脚本、安装器视觉资源、after-pack 资源注入。
- `dist/`：本地构建产物，已被 git 忽略。根部只放当前发布资产。
- `updates/`：软件运行时更新区，已被 git 忽略。下载和补丁备份分开。
- `backups/`：人工归档/历史实验备份，已被 git 忽略。不要和 `updates/` 混用。
- `node_modules/`：依赖目录，通常不要手动整理。

## 本地分区约定

### dist 发布区

`dist` 根部只保留当前可发布资产。`v1.1.0` 安全发布只上传安装包、可选 blockmap 和 SHA256，不上传 `latest.yml`：

- `Mineradio-<version>-Setup.exe`
- `Mineradio-<version>-Setup.exe.blockmap`
- `Mineradio-<from>-to-<to>.patch.json`

其它内容放到：

- `dist/_archive/previous-releases/`：旧安装包和旧 blockmap。
- `dist/_archive/inconsistent-builds/`：和 `latest.yml` 不匹配的构建，保留但不用于发布。
- `dist/_previews/`：截图、安装器预览、图标预览。
- `dist/_logs/`：builder debug 等构建日志。

### updates 更新区

- `updates/downloads/`：运行时下载的完整安装包或更新资产。
- `updates/backups/patches/`：快速补丁覆盖文件前的备份。
- `updates/tmp/`：临时文件。

对应代码常量在 `server.js`：

- `UPDATE_WORK_DIR`
- `UPDATE_DOWNLOAD_DIR`
- `UPDATE_PATCH_BACKUP_DIR`

### backups 备份区

- `backups/public-html/`：历史前端实验 HTML。
- `backups/tool-cache/`：本地工具缓存或历史缓存文件。

这个目录是人工归档区，不参与软件更新流程。

## 已完成工作日志

### 2026-07-04

- 【app 图标 dev 模式显示通用文档图标】用户反馈启动后 logo 变空白文档。排查：build/icon.ico 有效(7 尺寸 16-256)、main.js 主窗口 icon:APP_ICON_ICO、setAppUserModelId、title 都正常——是 Electron dev(npm start)已知现象:任务栏用 electron.exe 通用图标，真实图标只在打包 exe 生效。改善：主窗口创建后加 mainWindow.setIcon(icon.ico，回退 icon.png)，配合已有的 setAppUserModelId 尽量让 dev 任务栏显示真实图标。定论仍是打包后 exe 图标正确。

- 【华语歌词时间轴回归 LrcLib 优先】用户反馈华语歌用网易云歌词时间轴不准。原因：之前为日语覆盖把 CJK 全改网易云优先，连 LrcLib 有且对得更准的华语歌也被顶掉(网易云用它自己版本时间轴，会漂)。改回：resolveLyrics 一律 LrcLib 优先(LrcLib 按时长匹配，时间轴最贴合正在播放的 YTM 版本)→ 同步歌词没有时 CJK 用网易云补覆盖(日语仍能拿到)→ LrcLib 纯文本 → 非 CJK 网易云兜底 → YTM 纯文本。这样华语用 LrcLib(准)、日语 LrcLib 缺失时落网易云(有覆盖)。注：网易云做音源不可行(海外/马来西亚版权地区封锁+VIP，正是当初迁走原因)。不同版本歌靠 LrcLib 时长匹配自动挑最接近版本；进一步需手动歌词偏移(offset)微调，尚未实现。

- 【电台接续/自动续播】用户要求搜一首播放后自动接推荐(非歌单)。后端新增 mapPanelVideo() + /api/radio?id= 用 yt.music.getUpNext(id,true) 返回相关推荐(自动电台队列)。前端 maybeExtendQueueWithRadio(song)：当前歌是队列最后一首且是 YTM 歌(非播客/本地)时，后台拉 /api/radio 去重追加到 playQueue；在 playQueueAt 的 session-begin 后非阻塞调用。radioSeedId 防同种子重复拉；队列每到底用新末尾歌当种子→无限接续。歌单会先放完再接电台(因为只在 currentIdx>=length-1 触发)。radioAutoplayOn 默认 true(暂无 UI 开关)。沙盒无 YT 需本机验证。

- 【控制台中文乱码】Windows 控制台默认 GBK/936 代码页把 UTF-8 中文日志显示成乱码(英文正常)。在 desktop/main.js 和 server.js 顶部加 win32 下 execSync('chcp 65001',{stdio:ignore}) 切 UTF-8 代码页。仅影响 npm start 开发控制台，打包 exe 无控制台不受影响。(又踩挂载截断：Edit server.js 后尾 server.listen 块丢失，python 补回；后续改 server.js 尽量用 bash/python。)

- 【CJK 歌词优先网易云】用户要求日语歌走网易云。重构 fetchNeteaseLyric(取原词+译词，有时间轴即返回)，fetchNeteaseTranslatedLyric 复用它仅在有译词时返回。resolveLyrics 瀑布改为：looksCJK(假名 \u3040-\u30FF + 中日韩汉字 \u3400-\u9FFF + 谚文 \uAC00-\uD7A3) 为真→网易云原词优先(LrcLib 兜底)；非 CJK→LrcLib 优先(网易云兜底)；再 LrcLib 纯文本 / YTM 纯文本。放宽到 CJK 是因为罗马字标题的日语歌(如 Lemon/米津玄師)只能靠汉字歌手名识别，且网易云对中文/韩文覆盖也好。注意：CJK 歌原词改用网易云时间轴(它挑时长最接近版本)，可能与播放版本略有偏差——这是覆盖率 vs 精确对齐的取舍。其它可选源(未接)：酷狗 KRC 逐字、QQ 音乐，均中国服务器有同样稳定性顾虑；LrcLib 是唯一非中国、最稳的。

- 【翻译质量升级 + 时间轴对齐】用户反馈 Google 免费翻译日语差(如把「ざまあ/活該」音译成扎马)、且担心网易云翻译时间轴对不上(不同版本/翻唱)。方案:/api/lyric/translate 优先网易云社区人工双语歌词(music.163.com/api/song/lyric?tv=1，公开接口无需登录，仅借用其翻译文字，非恢复音乐源)。关键:不用网易云时间轴——把网易云 原词↔译词 按时间戳配对成 归一化原词→译词 map，再用【前端传来的 LrcLib 原词行】做文字匹配取译文，套 LrcLib 时间轴(=按播放版本时长匹配，与音频对齐)；匹配≥40%才采用，未匹配行 Google 补翻，匹配<40%(版本差异大)整首退回机翻。requestText 加 timeoutMs(网易云 5-6s)。前端只用 r.translated 套原词行。新增 parseLrcEntries/normLyricLine/buildNeteaseTransMap。沙盒墙了 music.163/googleapis，需本机验证；网易云在马来西亚可能慢/不稳，慢时会 5-6s 后回退机翻。

- 【新功能：歌词中文翻译切换】后端 googleTranslateLines()(translate.googleapis.com 免费 gtx 端点，40 行/块，逐行 \n 对齐) + POST /api/lyric/translate {lines,to}→{translated}。前端新增 lyricTranslation 状态 + toggleLyricTranslation/applyLyricTranslationState(POST 原词行→译词行，复用原 t/duration，words 置空不做逐字)/applyTranslatedLyricsState(lyricSourceMode=translated)/updateLyricTranslateBtn；fetchLyric 新歌后 resetLyricTranslationForNewSong()(清缓存，开关开着则自动重译，静默)。UI：控制栏「词」按钮后加 #lyric-translate-btn「译」(复用 .ctrl-btn.active/.busy 样式)。译词缓存按 songLyricTranslateKey。Google 翻译不可达时返回空→前端回退原文，不崩。沙盒墙了 googleapis，需本机验证。

- 【歌词几乎全空修复】原 /api/lyric 只用 yt.music.getLyrics(id)：只返回纯文本(无时间轴,3D 粒子没法同步)且覆盖率低。照 Metrolist 改成多源瀑布：主力 LrcLib(lrclib.net，按 歌名+歌手(取主歌手)+专辑+时长 精确匹配 /api/get，失败走 /api/search 选带 syncedLyrics 且时长最近的)返回逐行时间轴 LRC 塞进 r.lyric(前端 parseLyricText 解析时间戳)；YTM 内置歌词作纯文本兜底。新增 fetchLrcLibLyrics()+resolveLyrics()(带 500 条缓存)，/api/lyric 与 handleSpotifyLyric 都走 resolveLyrics。前端 fetchLyric 现在把 name/artist/album/duration(秒) 传给后端。沙盒连不上 lrclib.net(000)，需本机验证；若用户在墙内且 lrclib 被挡，需配代理。

- 【Daily 真实个性化推荐】原 handleDiscoverHome 的 dailySongs 只取一个写死歌单（VLPL4fGSI...Top100 Global）的前 12 首，对所有人一样、非每日非个性化。改为：登录时优先 yt.music.getHomeFeed()（YouTube Music 真实首页 Quick Picks/为你推荐），新增 extractHomeFeedSongs() 从 feed.sections 各 shelf 抽取 11 位 videoId 的可播放歌曲；返回加 personalized 标志；拿不到/未登录才回退全球榜单。首页审计结论：我的歌单(/api/user/playlists 真实库)、继续听(本地播放历史)、听歌画像/常听歌手(播放历史统计)本来就是真实的；只有 Daily/私人雷达 是假的，本次修复。需本机登录 YTM 验证真实推荐效果。

- 【节奏分析永久卡住修复】症状：每首歌点进去一直显示“正在分析节奏”不停。根因：节奏分析要完整下载整曲解码（analyzeAudioBeats 对 /api/audio?url=ytm: 不带 Range 的完整 fetch），而 googlevideo 对无 Range 的整段下载会限速到播放速度（throttling），一首 3 分钟歌要下 3 分钟。修复：server.js /api/audio 的 ytm 分支——带 Range（播放/seek）保持单次透传；不带 Range（完整下载/分析）改为 1MB 分块 Range 顺序拉取绕过限速（用 fmt.contentLength 判定结束，首块失败才回退 download()）。前端 analyzeAudioBeats 加 90s AbortController 超时兜底防止未来挂死。节奏律动本身逻辑没问题（OfflineAudioContext 分频段检测真实鼓点→beatmap→驱动镜头/粒子），之前跑不动纯粹是拿不到完整音频。沙盒无 YT 出口，需本机验证。

- 登录 UI 改版：把顶部标签切换+单卡片的登录弹窗改成两行式平台选择器（一行 YouTube Music、一行 Spotify），点任一行直接拉起该平台官方授权窗口；行内显示 busy（登录中…）/connected（已连接）状态。删除 tabs、qr-shell、title/desc、我两个都要 等旧元素；Spotify 手动 cookie 导入保留为常驻次级按钮，桌面窗口不可用时自动展开。新增 startProviderLogin(provider)，重写 updateLoginProviderUi/refreshQr。setLoginProvider 变为无害死代码。
- 音质选择器已删：YTM 音源是后端匹配的明文流，前端选音质无意义（网易云/QQ 遗留）。删掉底部 quality-control UI 和对应引导步骤；playbackQuality 相关 JS 保留为 null-safe 空操作。

- 【音源核心重写·照搬 Metrolist】读了 Metrolist 源码（innertube/InnerTube.kt + YouTubeClient.kt）后确认：它不依赖 youtubei.js 拿流，而是直接 POST music.youtube.com/youtubei/v1/player，用 ANDROID_VR（Oculus Quest）客户端、loginSupported=false 所以【不带任何 cookie/Authorization 头】→ YouTube 对该客户端免 PoToken 且返回明文直链无需解密。youtubei.js 失败根因：它用 ANDROID_VR 1.65.10（新版易被封）且带 cookie 请求破坏免 PoToken。已在 server.js 重写 resolveYtmAudioFormat：手写 player 请求，客户端顺序 ANDROID_VR 1.43.32（Metrolist 选定，非自适应码率修复 YT Music 卡顿）→ ANDROID_VR 1.61.48 → TVHTML5_SIMPLY_EMBEDDED_PLAYER（年龄限制兜底）；pickBestAudioFormat 按 itag(251/140 优先)+bitrate 选纯音频明文格式；visitorData 复用 youtubei.js session。/api/audio 直链代理透传 Range 支持 seek，download() 仍作兜底。非 ytm 分支简化为通用透传，顺带删掉最后两个带 music.163/y.qq Referer 的残留函数。沙盒无 YT 出口只能验证结构（三客户端按序尝试、不崩、502 正常），需本机端到端测。
- 【再次踩坑】J:\Mineradio 挂载写入截断又发生 2 次：file 工具 Edit server.js 后尾部（/api/audio 全段+静态服务+server.listen）丢失。已改用 bash/python 在 Linux 挂载路径重建。教训：server.js 这类大文件的改动尽量用 bash/python 在 /sessions/.../mnt 路径做，file 工具 Edit 后必须 node --check + tail 验证。

- 【关键】播放 400/无法解密 根因修复：你本机日志显示 youtubei.js player 接口对 ANDROID/IOS 返回 400、WEB 报 No valid URL to decipher——这是 YouTube 2024-2025 强制 PoToken 所致，17.2.0 已是最新版无法靠升级解决。改 YTM_AUDIO_CLIENTS 首选 ANDROID_VR（Oculus Quest 客户端，当前免 PoToken 且返回明文直链无需解密），回退顺序 ANDROID_VR→TV→WEB_EMBEDDED→IOS→MWEB→ANDROID→WEB；download() 兜底默认客户端也改 ANDROID_VR。沙盒无 YouTube 出口无法端到端验证，需本机确认。若 ANDROID_VR 日后也被封，终极方案是引入 bgutils-js+jsdom 生成 poToken+visitor_data。
- 注意 J:\Mineradio 挂载偶发写入截断：本轮 Edit 后 server.js 尾部 server.listen 块丢失，已用 python 补回并核对函数/路由完整；每次大改后务必 node --check + 尾部检查。

- Spotify 播放遗留 bug 修复：退休从 QQ 继承的音质降级重试（retrySpotifyPlaybackWithCompatibleQuality 改 no-op）——Spotify 播放走 YTM 匹配与音质无关，旧逻辑会用不同音质参数重试同一 videoId 且弹误导性提示、抢在自动播放判断前执行；/api/spotify/song/url|lyric|artist/detail|song/comments 前端参数统一改为 id=spotifyId（原来传 Spotify 曲目根本不存在的 song.mid）。冒烟测试 7 条 spotify 路由均结构正确、未登录优雅降级。

- 播放被拦截修复：/api/audio 的 ytm: 分支改为多客户端回退解析直链（ANDROID→IOS→TV_EMBEDDED→WEB，getStreamingData），代理转发透传 Range 支持进度条 seek，直链失败回退 yt.download()，全败返回 502 JSON；新增 resolveYtmAudioFormat() 直链缓存 40 分钟与 /api/debug/audio 诊断端点。前端 attemptAudioPlay 区分 NotAllowedError（自动播放策略，提示点击）与音源失败（自动跳队列下一首/提示换源）。注意：沙盒无 YouTube 网络出口，音频端到端需本机验证。

- 按用户要求把所有网易云/QQ 逻辑替换干净：server.js 删除全部 QQ 后端与网易云死代码（约 900 行），新增 Spotify 真实后端 `/api/spotify/*`（sp_dc 会话 + Web API + TOTP），播放/歌词/评论自动匹配 YouTube Music 音源；评论统一 YouTube 评论源。
- desktop/main.js、preload.js、public/index.html 彻底改名（netease/qq → google\|youtube/spotify，含 IPC 通道、CSS 类、API 路径，约 500 处）；本地历史数据旧 provider 值与 'qq:' 歌单前缀保留兼容解析。
- package.json 移除 `NeteaseCloudMusicApi`、`spotify-web-api-node`；`.qq-cookie` → `.spotify-cookie` 自动迁移；README/PRIVACY/NOTICE/SECURITY/RELEASE/.gitignore 同步更新；docs/QQ_MUSIC_INTERFACE_NOTES.md 标记废弃归档。
- 验证：node --check 通过（server.js、desktop/main.js）、前端内联脚本 vm 解析通过、前后端 API 路径与 IPC 桥方法逐一比对一致；未上传或推送 GitHub。

### 2026-06-24

- 将 `E:\Download\默认测试.json` 接入为首次启动默认用户存档和默认视觉参数；新增 `public/default-user-fx-archive.json`，并让没有本地用户存档的新用户自动得到「默认测试」槽位。
- 更新 `CHANGELOG.md`、`README.md`、`SECURITY.md`、`RELEASE.md`、`docs/SECURITY_REBUILD_2026-06-24.md` 和 `docs/RELEASE_NOTES_v1.1.0.md`，恢复详细日志并写明 `v1.0.10` 旧安装包隔离、`v1.1.0` 纯净安装、不走软件内更新。
- 已执行 `npm run build:win`，第一次被旧代理 `127.0.0.1:26001` 拦截，切到 `127.0.0.1:10808` 后打包成功。产物：`dist/Mineradio-1.1.0-Setup.exe`、`.blockmap`、`Mineradio-1.1.0-SHA256SUMS.txt`。
- 已运行 `git diff --check`、`node --check server.js`、前端 5 个内联脚本解析、默认 JSON 解析、Git 跟踪高风险残留检查；Defender 对新安装包和 `win-unpacked` 扫描后 `Get-MpThreatDetection` 查询为空。
- 已发布 GitHub Release `v1.1.0`，上传安装包、blockmap、SHA256SUMS；未上传 `latest.yml`。已批量给旧 Release（`v1.0.10` 到 `v0.9.9`）追加旧安装包隔离警示。
- 检查并更新新对话交接：`docs/HANDOFF_NEXT_CHAT.md` 已改为当前 `v1.1.0` 源码安全重建状态。
- 本轮交接检查开始时工作树为干净：`main...origin/main`；随后仅修改 `AI_HANDOFF.md`、`docs/HANDOFF_NEXT_CHAT.md`、`docs/PROJECT_MEMORY.md`，并新增 `docs/3D_PLAYLIST_SHELF_MEMORY.md`。
- 已补全 3D 歌单架专项记忆：控制台模式、常驻/静态镜头、详情页层级、歌词避让、右键歌单架抑制底部控制台、不要推倒重做手感等边界写入 `docs/3D_PLAYLIST_SHELF_MEMORY.md`。
- 项目记忆 `docs/PROJECT_MEMORY.md` 已包含 `2026-06-24 - 1.1.0 安全重建源码优先`，记录不要复用旧感染环境产出的安装包、旧 `dist`、旧 `node_modules` 或临时扫描资料。
- 安全重建日志在 `docs/SECURITY_REBUILD_2026-06-24.md`，后续安装包发布必须从当前 Git-tracked 源码重新构建并扫描。

### 2026-06-18

- 发布 `v1.0.4` 到 GitHub：`https://github.com/XxHuberrr/Mineradio/releases/tag/v1.0.4`。
- 本次发布包含安装包 `Mineradio-1.0.4-Setup.exe`、`latest.yml`、blockmap，以及 `1.0.0/1.0.1/1.0.2/1.0.3 -> 1.0.4` 四个快速补丁 JSON。
- 主要修复：最小化/隐藏时深度低占用但可见失焦不降帧；全屏 3D 视觉画布尺寸同步避免裁切；控制台隐藏残影；控制台玻璃色差滑条；左侧歌单详情分批加载和置顶；沉浸模式恢复左侧歌单栏、3D 歌单架和封面渐变背景。

### 2026-06-06

- 发布 `v0.9.11`。
- 修复新用户首次进入未登录时展示不可控外部推荐封面的问题。
- 未登录首页改为安全 starter 内容，不再拉取公共推荐。
- 登录弹窗增加“音乐播放器 + 视觉舞台”说明，并提供“先搜索一首歌”路径。
- 视觉引导改成产品用途导向。
- 增加完整安装包下载进度：大小、速度、ETA、状态提示。
- 增加快速补丁通道：`/api/update/patch` 和 `/api/update/patch/status`。
- 生成并上传 `Mineradio-0.9.10-to-0.9.11.patch.json`。
- 注意：已经安装的 `0.9.10` 本身没有补丁器，所以从 `0.9.10` 升到 `0.9.11` 仍需完整安装包一次。

### 2026-06-07

- 重新设计 Windows NSIS 安装器。
- 加入深色标题栏、品牌页头、安装器侧栏、深色欢迎页。
- 跳过默认白色安装模式页。
- 用自定义深色目录页替代默认白色目录页，保留路径输入和 Browse 按钮。
- 默认安装路径仍优先 `D:\Mineradio`。
- 重新打包并覆盖 GitHub Release `v0.9.11` 的安装包、blockmap、latest.yml。
- 提交：`28d3cef Restyle Windows installer`。

### 2026-06-08

- 整理工作区。
- `dist` 根部恢复为当前发布资产区。
- 旧安装包移动到 `dist/_archive/previous-releases/`。
- 安装器预览截图移动到 `dist/_previews/installer-visual-20260607/`。
- builder debug 文件移动到 `dist/_logs/`。
- 历史前端实验文件移动到 `backups/public-html/`。
- 工具缓存文件移动到 `backups/tool-cache/`。
- 创建 `updates/downloads/`、`updates/backups/patches/`、`updates/tmp/`。
- `server.js` 更新为下载区和补丁备份区分离。
- Home 页完成视觉升级：首屏增加唱片、封面套、频谱视觉块，未登录/无封面时的卡片、拼贴和推荐入口都会生成彩色音乐封面占位，减少纯文字和空黑区域。
- 修正 Home 页矮屏排版：右侧卡片和推荐入口不再叠压，标题不会把“今天想听什么”拆成尴尬换行。
- 已用本地 Chrome CDP 验证 `1280x720` 和 `390x720` 首屏，无页面级横向溢出；预览截图保留在 `dist/_previews/home-visual-20260608/`。
- 本次任务没有上传或推送 GitHub，遵守“未明确要求上传就不上传”的新规则。

### 2026-06-10

- 视觉控制台新增“封面清晰度”滑块，用于调节主封面粒子网格密度。
- 默认保持 `119x119`（约 1.42 万粒子），最高提升到 `183x183`（约 3.35 万粒子），让专辑封面粒子化后更清晰。
- 调整封面纹理加载逻辑：高清晰度档位会使用 `384/512` 尺寸的封面画布，避免只增加粒子但纹理源仍然偏糊。
- 清晰度参数会写入本地偏好；当前封面来源会被记录，拖动滑块后当前封面会按新清晰度自动重载。
- 修复部分封面在提高清晰度后出现割裂线的问题：粒子网格改为奇数尺寸，几何位置保留居中点，封面 UV 改为采样 texel 中心，shader 内对封面/上一张封面/边缘贴图采样做安全夹取，避免采样到纹理边界或偶数网格中心缝。
- 已用本地 Chrome CDP 验证滑块：默认 `119x119`，拉满 `183x183`，主粒子/溢光粒子共享高密度几何，dataUrl 封面纹理升到 `512x512`，WebGL `glError=0`。
- 本次任务没有上传或推送 GitHub。

### 2026-06-13

- 用户明确要求上传 GitHub 后，已将 Home 视觉升级、封面清晰度控制、封面粒子割裂线修复和交接说明更新提交并推送到 `origin/main`。
- 已推送提交：`21f6052 Polish home visuals and cover particles`。
- 按用户“不能只上传源码，要包含软件 exe”的要求，继续升版本到 `0.9.12` 并重新构建 Windows 安装包。
- 已生成 `dist/Mineradio-0.9.12-Setup.exe`、`dist/Mineradio-0.9.12-Setup.exe.blockmap`、`dist/latest.yml`。
- 已生成轻量快速补丁 `dist/Mineradio-0.9.11-to-0.9.12.patch.json`，补丁只覆盖 `package.json`、`package-lock.json`、`public/index.html`，用于已安装 `0.9.11` 的用户快速更新视觉和封面粒子修复。
- 已创建并核对 GitHub Release `v0.9.12`：`https://github.com/XxHuberrr/Mineradio/releases/tag/v0.9.12`，远端包含安装包、blockmap、`latest.yml` 和 `0.9.11-to-0.9.12` 快速补丁。
- 本地试做新版开场动画：参考 `ShipSwiftAnimatedLoop` 的霓虹通道分离、光流和切片感，但放弃环形方案，改为横向光刃切入、彩色尾迹、碎片条和黑金控制台背景，主要改动在 `public/index.html`。
- 已用本地 Chrome/CDP 重播 splash 并截取 `updates/tmp/splash-replay-0700.png`、`updates/tmp/splash-replay-1800.png`、`updates/tmp/splash-replay-2900.png`；本次只是本地试效果，没有上传或推送 GitHub。
- 用户反馈上一版“不如动画库惊艳”后，继续把 splash 背景从 2D canvas 升级为 WebGL shader：移植 `ShipSwiftAnimatedLoop` 的 `lineWidth / abs(f)` 高亮线场、RGB channel offset、Neon angular wobble 和 Warp 距离场，并保留 2D fallback。新预览截图为 `updates/tmp/splash-webgl3-0700.png`、`updates/tmp/splash-webgl3-1800.png`、`updates/tmp/splash-webgl3-2900.png`；仍未上传或推送 GitHub。
### 2026-06-14

- 根据用户反馈，移除 splash 中刻意的环形/花瓣式爆点，改为更自然的斜向流线相位同步高光，避免“环形像菊花”的观感。
- splash 现在不再自动进入 Home：动画跑完后进入 `ready` 状态，显示轻量“点击进入”，用户点击任意位置或按 Enter/空格后才调用 `dismissSplash()`。这样用户可以停留欣赏动画。
- 已用本地 Chrome/CDP 验证：`updates/tmp/splash-click-ready.png` 显示 6.4 秒后仍停在 splash 且 `className=ready`，`updates/tmp/splash-after-click.png` 显示点击后进入 Home；本次没有上传或推送 GitHub。
- 用户随后明确要求上传 GitHub：已升级到 `0.9.13`，更新 `CHANGELOG.md` 和 `RELEASE.md`，生成 `dist/Mineradio-0.9.12-to-0.9.13.patch.json` 快速补丁，并重新构建 `dist/Mineradio-0.9.13-Setup.exe`、`dist/Mineradio-0.9.13-Setup.exe.blockmap`、`dist/latest.yml`。
- 已推送提交 `4d9044a Prepare Mineradio 0.9.13 release` 到 `origin/main`，并创建 GitHub Release `v0.9.13`：`https://github.com/XxHuberrr/Mineradio/releases/tag/v0.9.13`。远端资产包含安装包、blockmap、`latest.yml` 和 `0.9.12-to-0.9.13` 快速补丁。
- 注意：本机 `gh` 命令曾被失效代理 `HTTP_PROXY/HTTPS_PROXY=http://127.0.0.1:26001` 挡住。使用 GitHub CLI 发布时可在当前命令里临时清空 `HTTP_PROXY`、`HTTPS_PROXY`、`ALL_PROXY` 后再执行。

## 未完成/待确认事项

- Spotify 令牌接口（get_access_token + TOTP）为社区参数，Spotify 轮换后需更新 server.js `spotifyTotpSecretBytes()`；建议真机连一次 Spotify 账号做端到端验证。
- Spotify 歌曲的红心/收藏同步（/v1/me/tracks PUT）尚未实现，前端仍是占位 toast。

- `v1.1.0` 发布时不要上传 `latest.yml` 或快速补丁；Release 需要通过 `--latest=false` 或等价 API 避免成为旧版软件内更新通道的 latest。
- 搜索结果排序仍需要继续优化：例如“日落大道”应优先梁博原唱，“Beauty and a Beat”应优先原唱/官方版本，避免翻唱排第一。
- 3D 歌单架交互仍需继续优化：悬停展开和点击后可用状态之间要更丝滑，避免用户误以为悬停后可直接使用。
- Home 页面与后方 3D 歌单架的交互穿透问题需要继续关注。
- 如果之后修改发布资产，记得同步 GitHub Release、`latest.yml`、blockmap，并检查本地 `dist` 根部资产是否一致。

## 每次任务完成后的固定动作

1. 更新本文件的「已完成工作日志」。
2. 如果发现新问题，更新「未完成/待确认事项」。
3. 如果整理了文件，更新「工作区地图」或「本地分区约定」。
4. 如果改了代码，至少运行相关语法检查或构建检查。
5. 如果改了安装包或更新逻辑，检查安装包、blockmap、校验文件和 GitHub Release 是否一致；安全发布时特别确认不要误上传 `latest.yml`。
6. 最后确认 `git status --short`，说明哪些已提交、哪些只是本地忽略产物。
