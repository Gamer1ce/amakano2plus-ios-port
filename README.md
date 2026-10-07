# 甜蜜女友 2＋｜iPad / iPhone 非官方移植

《甜蜜女友 2＋》的非官方 iPad / iPhone 移植实现。公开源码以本地 R20
普通版为基线：JavaScript 剧情运行时、画面与音频适配、存读档、CG / 回想
界面，以及 Swift `WKWebView` 容器与资源格式工具。项目面向已有合法游戏资源
的开发者研究和维护，不提供游戏本体下载。

**本仓库只有代码，不含原版资源或 IPA。** 克隆后不能直接游玩；人物模型、
台词、图片、音乐、视频、从游戏提取的配置表和第三方播放器都需要本地提供。
源码采用 [MIT](LICENSE)，其他组件见 [第三方说明](THIRD_PARTY_NOTICES.md)。

## 游戏内功能

以下功能基于 R20 普通版的实现。运行游戏仍需完整本地资源与第三方播放器。

| 功能 | 使用方式与说明 |
| --- | --- |
| 开始游戏 | 从主菜单进入故事，点击画面推进对白，在选项窗口选择分支 |
| 选择故事 | 提供结灯、玲、千岁、咲来的 9 个故事入口，切换前建议存档 |
| 自动阅读 | 点击“自动”启动，再次点击停止；基础间隔可在 1–10 秒之间调整，长对白会延长等待 |
| 对白回看 | 点击“回看”查看当前剧情中记录的说话人和对白 |
| 存档 / 读档 | 8 个本机存档位置，列表显示保存时间、剧情位置和对白摘要 |
| 场景回想 | 按角色和分页浏览已解锁回想，选择缩略图进入对应场景 |
| CG 鉴赏 | 按角色浏览 CG；支持“上一差分”“下一差分”，返回时恢复之前的剧情画面 |
| 一键解锁 | 设置中打开“解锁全部回想与 CG”；关闭后重新按实际游玩进度开放 |
| 声音设置 | 分别调节音乐、语音、音效和影片音量，并支持统一静音 |
| 声音恢复 | 浏览器限制播放时显示“恢复声音”，点击后尝试恢复音频或影片 |
| 主角资料 | 首次启动设置姓名、生日和生日陪伴角色，之后可在设置中修改 |
| 显示偏好 | 提供体毛、爱心眼与默认 / 内衣 / 裸体显示模式，适用范围依具体场景资源 |
| 横屏与键盘 | 横屏自适应显示；Mac 浏览器预览时可用空格或 Enter 推进对白 |
| 兼容性记录 | 菜单可查看兼容处理、资源状态及运行错误信息，便于提交问题 |

详细操作、故事入口、存档注意事项和版本区别见
[中文游戏功能与使用说明](docs/游戏功能与使用说明.md)。

## IPA 与下载状态

IPA 是编译后的安装包，源码开源与安装包下载是两种交付。
当前公开仓库提供源码，尚未公开上传包含原版素材的完整版 IPA。
源码的 MIT 许可证不授予原版游戏素材或第三方播放器的再分发权。

本地 R20 普通版安装包为未签名 IPA，安装需要自行签名。若发行包含原版素材的
安装包，需先确认这些内容的公开再分发授权，并单独注明各自许可。
GitHub Releases 单个附件必须小于 2 GiB，约 6.25 GB 的本地完整包不能以单一
附件直接上传；有授权的完整包需要分卷，下载齐所有分卷并合并后才能签名安装。
参见 [GitHub Releases 官方限制](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases)。

## 当前状态

- 横屏 iPad / iPhone 容器，离线 `game://` 文件服务及音视频字节范围请求。
- 剧情 VM、角色图层和动作、过场效果、字幕、声音、存档与恢复。
- 场景回想 / CG 鉴赏，一键解锁开关。
- R20 的字幕层级、WebKit 滤镜过场捕获与旧字幕残留修正。
- 公开版额外补强资源路径的符号链接校验，覆盖不存在的目标文件。
- 公开版提供资源导入和构建工具，不包含之前的加速测试版。

已有局部 Mac WebKit 验证；**没有完成全剧情逐条游玩及签名后 iPad 实机验收**。
源码检查和自动化单元测试不等于完整游戏验收，不承诺零 bug。

## 目录

| 目录 | 用途 |
| --- | --- |
| `runtime/` | R20 运行时与渲染适配；游戏配置表需本地导入 |
| `ios/App/` | Swift 容器、路径校验、音视频 Range 请求 |
| `ios/` | Xcode 工程生成、Content 校验与未签名 IPA 打包 |
| `portkit/` | 独立的 KIF / CatScene / HG-3 读取和资源转换工具 |
| `tools/` | 本地资源导入、源码同步、构建与公开内容检查 |
| `tests/` | 不使用原游戏素材的合成测试 |

## 源码检查

需要 Python 3.10+、Node.js 20+；资源转换另需 FFmpeg。

```sh
python3 -m venv .venv
source .venv/bin/activate
python3 -m pip install -r requirements.txt
python3 tools/check-public-tree.py
python3 -m unittest discover -s tests
python3 -m unittest discover -s portkit/tests
python3 -m unittest discover -s ios/tests
node --test tests/runtime.test.mjs
```

## 使用自己的本地资源构建

目前公开的原版格式工具只覆盖部分转换流程，**不声称能够从 Windows 原版
一键重新生成全部 R20 配置**。已有完整 R20 普通版的合法本地资源时，可从
自己的未签名 IPA 导入资源；导入器不会运行或上传 IPA，也不会复用原 IPA
中的可执行程序和签名。

```sh
python3 tools/import-local-content.py --ipa /path/to/your-own-R20.ipa
python3 tools/sync-runtime.py
python3 tools/generate-ios-project.py
open ios/AmakanoPort.xcodeproj
```

导入完整资源约需要额外 6–8 GB。生成工程需要 macOS、完整 Xcode 和 iOS SDK；
Swift 工程的最低系统配置为 iOS 17，原项目目标设备为 iPadOS 26。真实兼容性
仍须在对应设备验证。Xcode 中选择自己的 Team 与设备后可以自行构建签名。

或生成仅供自己签名的 IPA：

```sh
bash tools/build-ios.sh
```

输出位于 `build/Amakano2Plus-unsigned.ipa`。新构建不能视为原 R20 安装包的
二进制复现；公开工程的构建配置与签名环境需自行验证。详见
[资源与构建流程](docs/BUILD.md)。

## 参与维护

提交问题时描述设备、版本、重现步骤和预期行为。请使用合成素材提交测试，
不要上传原游戏截图、台词、配置、存档中的私人信息或完整安装包。
本地验收记录、电脑路径与旧版本开发历史没有发布到本仓库。
