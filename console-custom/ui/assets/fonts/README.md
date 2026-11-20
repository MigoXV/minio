# 自托管字体

沿用 Figma MinIO v2 的 Inter / Noto Sans SC / IBM Plex Mono 字体体系。Inter 继续使用现有 MDS 字体资源。

- `NotoSansSC.woff2`：Google Fonts 的 Noto Sans SC 可变字体，保留字重轴和中文、拉丁文字、标点范围，转换为 WOFF2。
- `IBMPlexMono-Regular.woff2`：Google Fonts 的 IBM Plex Mono Regular，转换为 WOFF2，用于音频时间码与代码。
- 两份原始 SIL Open Font License 随文件保留。浏览器从本站加载字体，不请求外部字体服务。

来源目录：Google Fonts 仓库 `ofl/notosanssc`、`ofl/ibmplexmono`。转换工具为 FontTools / Brotli，只用于构建准备，不是应用运行依赖。
