# Mineradio Next Chat Handoff

更新时间：2026-06-21

## 新对话先执行/先读

```powershell
cd E:\桌面\播放器软件\Mineradio\resources\app
git status --short --branch
git log --oneline -3 --decorate
Get-Content AGENTS.md
Get-Content docs\PROJECT_MEMORY.md
Get-Content docs\HANDOFF_NEXT_CHAT.md
```

也可以直接把这段发给新对话：

```text
继续 Mineradio 项目。真实代码目录是 E:\桌面\播放器软件\Mineradio\resources\app，不要改旧外层源码目录。先读 AGENTS.md、docs/PROJECT_MEMORY.md、docs/HANDOFF_NEXT_CHAT.md，再继续处理我的新需求。
```

## 当前状态

- 当前正式版本：`v1.0.7`
- 当前发布提交：`b8a8b39 Prepare Mineradio 1.0.7 release`
- 当前 tag：`v1.0.7`
- GitHub Release：`https://github.com/XxHuberrr/Mineradio/releases/tag/v1.0.7`
- 可运行程序：`E:\桌面\播放器软件\Mineradio\Mineradio.exe`
- 真实代码/Git 仓库：`E:\桌面\播放器软件\Mineradio\resources\app`
- 统一备份目录：`E:\桌面\播放器软件\工作区备份`

## 刚完成的事

- 已发布 `v1.0.7`。
- 电影镜头快节奏节拍分析做过一轮试调；用户反馈“感觉还是不好”，后续如果再碰这块要谨慎，不能继续盲目加力。
- 骷髅预设已改名为“安魂”，第二行是“骷髅·YUI7W”，卡片使用黑体；自定义视觉色会同步强化骷髅粒子颜色，蓝色不再被金色骨色明显中和。
- 软件内更新日志和 GitHub Release notes 使用文案：`反正没什么人看，布想写日志了`。
- 已上传完整安装包、`latest.yml`、blockmap，以及 `1.0.0` 到 `1.0.6` 升 `1.0.7` 的快速补丁。
- 当前未发布改动：QQ 音乐接口播放授权记录已保存到 `docs/QQ_MUSIC_INTERFACE_NOTES.md` 和 `docs/PROJECT_MEMORY.md`；Home 左侧大卡片改为“🚧此处施工，敬请期待🚧”，支持展开播放器控制台；视觉预设显示顺序改为 emily、安魂、星河、唱片、星球、滚筒、虚空；视觉控制台新增 4 槽位“用户存档”；启动时会重新应用已保存的歌词预设/自定义颜色。

## 发布资产

- `latest.yml`
- `Mineradio-1.0.7-Setup.exe`
- `Mineradio-1.0.7-Setup.exe.blockmap`
- `Mineradio-1.0.0-to-1.0.7.patch.json`
- `Mineradio-1.0.1-to-1.0.7.patch.json`
- `Mineradio-1.0.2-to-1.0.7.patch.json`
- `Mineradio-1.0.3-to-1.0.7.patch.json`
- `Mineradio-1.0.4-to-1.0.7.patch.json`
- `Mineradio-1.0.5-to-1.0.7.patch.json`
- `Mineradio-1.0.6-to-1.0.7.patch.json`

## 当前工作树提醒

- `main` 已推送到 `origin/main`，`v1.0.7` tag 已推送。
- 当前有未发布修改：`desktop/main.js`、`server.js`、`public/index.html`、`docs/PROJECT_MEMORY.md`、`docs/HANDOFF_NEXT_CHAT.md`，以及新增 `docs/QQ_MUSIC_INTERFACE_NOTES.md`。
- 未跟踪临时验证目录：`.playwright-cli/`、`output/`。
- 这些临时目录不在发布包里，不要误提交；也不要删除备份。

## 重要习惯

- 用户主要中文沟通，偏好直接修复、直接验证、直接发布。
- GitHub/gh 需要代理时使用：`http://127.0.0.1:10808`，不要使用旧端口 `26001`。
- 不要用 `git reset --hard` 或 `git checkout --` 回滚用户改动。
- 如果用户说“保留/记住/保存/这个很好/我喜欢”，同步更新 `docs/PROJECT_MEMORY.md`。
- 玻璃 SVG 质感相关任务先读：`docs\GLASS_SVG_TEXTURE.md`。

## 骷髅预设记忆

- 用户认可当前低角度仰视压迫感，不要改回平视。
- 点云要贴合模型表面、均匀规整，不要回到散乱星尘感。
- 3D 歌单架打开时应使用左侧大骷髅近景、右侧偏中歌单架构图。
