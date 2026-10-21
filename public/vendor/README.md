# 本地浏览器依赖

- ExcelJS 4.4.0：`exceljs/dist/exceljs.min.js`，用于本地 XLSX 工作簿解析。来源为 npm registry 的 `exceljs@4.4.0` 包，使用 npm 默认 TLS 与包完整性校验下载。许可证见 EXCELJS-LICENSE。
- JSZip 3.10.2：`jszip/dist/jszip.min.js`，用于 ZIP 批量解压。来源为 npm registry 的 `jszip@3.10.2`（本次下载后随项目固定附带）。许可证见 JSZIP-LICENSE。

项目运行时不从 CDN 下载脚本，不执行 Excel 公式，不访问报表中的超链接。
