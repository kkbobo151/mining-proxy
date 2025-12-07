#!/bin/bash

#############################################
# 打包脚本 - 生成部署包
#############################################

echo "正在打包部署文件..."

# 确保已编译
npm run build

# 创建部署包目录
rm -rf deploy-package
mkdir -p deploy-package

# 复制必要文件
cp -r dist deploy-package/
cp package.json deploy-package/
cp config.json deploy-package/
cp deploy.sh deploy-package/
cp -r scripts deploy-package/ 2>/dev/null || true

# 创建压缩包
tar -czvf mining-proxy-deploy.tar.gz deploy-package

# 清理
rm -rf deploy-package

echo ""
echo "✅ 打包完成: mining-proxy-deploy.tar.gz"
echo ""
echo "部署步骤:"
echo "  1. 上传到 CentOS: scp mining-proxy-deploy.tar.gz root@服务器IP:/tmp/"
echo "  2. SSH 登录服务器: ssh root@服务器IP"
echo "  3. 解压: cd /tmp && tar -xzf mining-proxy-deploy.tar.gz"
echo "  4. 执行部署: cd deploy-package && bash deploy.sh"
echo ""

