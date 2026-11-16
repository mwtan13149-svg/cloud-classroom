# 云端课室

教师用的 PDF 书写与随机点名网页。[打开 GitHub Pages 试用版](https://mwtan13149-svg.github.io/cloud-classroom/)。

## 使用方式

1. 在左上角创建课室。每间课室分别保存 PDF、学生名单和笔迹。
2. 上传真实 PDF，按需要添加空白页、书写和荧光标记。
3. 在 PDF 右上角点「导出笔记」，下载带笔迹的 PDF，然后上传到 Google Classroom 或 Google Drive。
4. 定期在「我的课室」下载 ZIP 备份。ZIP 包含该课室的原 PDF、笔迹、空白页顺序和名单；导入备份会创建新课室，不覆盖现有资料。

课室内可搜索、改名、上移、下移和删除 PDF。删除资料会同时删除笔迹，请先备份。

## 数据保存

这是静态网页试用版。PDF 与笔迹保存在**当前浏览器**的 IndexedDB，课室和名单保存在当前浏览器的 localStorage。换电脑或浏览器时，请用 ZIP 备份搬迁资料。清除网站数据会移除本机资料。Google Classroom／Drive 上传仍需老师手动完成。老师账号、学生访问和真正的云端权限控制尚未接入。

## 发布与许可

仓库根目录即网站文件。GitHub Pages 设置为从 `main` 分支的 `/(root)` 发布，无需 Node.js 构建。PDF.js、pdf-lib、JSZip 的许可声明分别在 `assets/pdfjs-LICENSE.txt`、`assets/pdf-lib-LICENSE.md`、`assets/jszip-LICENSE.md`。猫咪图案由项目使用者提供。
