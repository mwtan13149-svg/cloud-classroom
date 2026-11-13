# 云端课室

课堂 PDF 批注与随机点名网页试用版。老师可导入 PDF、逐页书写、保存本机批注，并从学生名单中进行跑马灯式随机点名。

## 在 GitHub Pages 发布

本仓库根目录就是静态网站，无需安装 Node.js 或执行构建。把文件推送到 GitHub 后，在仓库的 **Settings → Pages** 中选择 **Deploy from a branch**，再选择 **main** 分支和 **/(root)** 文件夹，保存后等待 GitHub Pages 完成发布。

## 当前试用版的保存方式

上传的 PDF、批注和学生名单保存在使用者当前浏览器的本地数据中。换电脑或换浏览器不会自动同步。老师账号、学生免登录访问、跨设备实时同步和云端备份尚未接入。首页的四份示例 PDF 是界面演示内容。

`assets/pdf.mjs` 与 `assets/pdf.worker.mjs` 使用 PDF.js；其许可声明见 `assets/pdfjs-LICENSE.txt`。猫咪图案由项目使用者提供。
