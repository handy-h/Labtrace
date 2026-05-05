# LabTrace Makefile
# =================

# 项目名称（与 go.mod module 名一致）
APP_NAME    := labtrace

# 从 .env 读取端口，默认 8080
PORT        := $(shell grep -Po '(?<=^PORT=)\S+' .env 2>/dev/null || echo 8080)

# PID 文件，用于记录运行中的进程
PID_FILE    := .labtrace.pid

# Go 编译参数
GO          := go
LDFLAGS     := -s -w

# 颜色输出
GREEN       := \033[0;32m
YELLOW      := \033[0;33m
RED         := \033[0;31m
CYAN        := \033[0;36m
RESET       := \033[0m

.PHONY: build dev run stop clean help

# ---- 默认目标 ----
help: ## 显示帮助信息
	@echo ""
	@echo "$(CYAN)LabTrace Makefile$(RESET)"
	@echo "=================="
	@echo ""
	@echo "$(GREEN)Usage:$(RESET) make <target>"
	@echo ""
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  $(GREEN)%-10s$(RESET) %s\n", $$1, $$2}'
	@echo ""

build: ## 编译生成可执行二进制文件
	@echo "$(CYAN)[build]$(RESET) 编译 $(APP_NAME)..."
	@$(GO) build -ldflags "$(LDFLAGS)" -o $(APP_NAME) .
	@echo "$(GREEN)[build]$(RESET) 编译完成: ./$(APP_NAME)"

dev: ## 开发者模式运行（丰富日志）
	@bash -c ' \
		if [ -f $(PID_FILE) ]; then \
			echo "$(YELLOW)[dev]$(RESET) 检测到 PID 文件，尝试先停止旧进程..."; \
			$(MAKE) --no-print-directory stop; \
		fi; \
		echo "$(CYAN)[dev]$(RESET) 以开发者模式启动..."; \
		GIN_MODE=debug ./$(APP_NAME) 2>&1 | tee -a dev.log & \
		DEV_PID=$$!; \
		echo $$DEV_PID > $(PID_FILE); \
		sleep 1; \
		if kill -0 $$DEV_PID 2>/dev/null; then \
			echo "$(GREEN)[dev]$(RESET) 已启动 (PID: $$DEV_PID, 端口: $(PORT), 日志: dev.log)"; \
		else \
			echo "$(RED)[dev]$(RESET) 启动失败，请检查日志"; \
			rm -f $(PID_FILE); \
		fi \
	'

run: ## 生产模式运行（仅必要日志）
	@bash -c ' \
		if [ -f $(PID_FILE) ]; then \
			echo "$(YELLOW)[run]$(RESET) 检测到 PID 文件，尝试先停止旧进程..."; \
			$(MAKE) --no-print-directory stop; \
		fi; \
		if ! [ -f $(APP_NAME) ]; then \
			echo "$(YELLOW)[run]$(RESET) 二进制文件不存在，先编译..."; \
			$(MAKE) build; \
		fi; \
		echo "$(CYAN)[run]$(RESET) 以生产模式启动..."; \
		GIN_MODE=release ./$(APP_NAME) & \
		RUN_PID=$$!; \
		echo $$RUN_PID > $(PID_FILE); \
		sleep 1; \
		if kill -0 $$RUN_PID 2>/dev/null; then \
			echo "$(GREEN)[run]$(RESET) 已启动 (PID: $$RUN_PID, 端口: $(PORT))"; \
		else \
			echo "$(RED)[run]$(RESET) 启动失败，请检查配置"; \
			rm -f $(PID_FILE); \
		fi \
	'

stop: ## 优雅关闭应用
	@bash -c ' \
		echo "$(CYAN)[stop]$(RESET) 正在停止..."; \
		if [ -f $(PID_FILE) ]; then \
			PID=$$(cat $(PID_FILE)); \
			if kill -0 $$PID 2>/dev/null; then \
				kill -15 $$PID; \
				echo "$(GREEN)[stop]$(RESET) 已发送 SIGTERM 到进程 $$PID"; \
				for i in 1 2 3 4 5; do \
					if ! kill -0 $$PID 2>/dev/null; then \
						echo "$(GREEN)[stop]$(RESET) 进程已退出"; \
						rm -f $(PID_FILE); \
						exit 0; \
					fi; \
					sleep 1; \
				done; \
				echo "$(YELLOW)[stop]$(RESET) 进程未在 5 秒内退出，发送 SIGKILL 强制终止"; \
				kill -9 $$PID 2>/dev/null; \
				rm -f $(PID_FILE); \
			else \
				echo "$(YELLOW)[stop]$(RESET) PID $$PID 已不存在，清理 PID 文件"; \
				rm -f $(PID_FILE); \
			fi; \
		else \
			echo "$(YELLOW)[stop]$(RESET) 未找到 PID 文件"; \
		fi; \
		PID_ON_PORT=$$(lsof -ti :$(PORT) 2>/dev/null); \
		if [ -n "$$PID_ON_PORT" ]; then \
			echo ""; \
			echo "$(RED)[stop]$(RESET) 端口 $(PORT) 仍被以下进程占用:"; \
			lsof -i :$(PORT) 2>/dev/null; \
			echo ""; \
			echo "$(YELLOW)[stop]$(RESET) 是否要强制结束占用端口的进程？[y/N] \c"; \
			read answer; \
			if [ "$$answer" = "y" ] || [ "$$answer" = "Y" ]; then \
				for p in $$PID_ON_PORT; do \
					kill -9 $$p 2>/dev/null; \
					echo "$(GREEN)[stop]$(RESET) 已强制终止进程 $$p"; \
				done; \
			else \
				echo "$(YELLOW)[stop]$(RESET) 已跳过，端口 $(PORT) 仍被占用"; \
			fi; \
		fi \
	'

clean: ## 清理临时文件、缓存及二进制文件（保留 ./data 目录）
	@echo "$(CYAN)[clean]$(RESET) 清理编译产物..."
	@rm -f $(APP_NAME)
	@echo "$(GREEN)[clean]$(RESET) 已删除二进制文件: $(APP_NAME)"
	@echo "$(CYAN)[clean]$(RESET) 清理 Go 缓存..."
	@$(GO) clean -cache -testcache -i 2>/dev/null || true
	@echo "$(GREEN)[clean]$(RESET) Go 缓存已清理"
	@echo "$(CYAN)[clean]$(RESET) 清理临时文件..."
	@rm -f *.log *.out *.test
	@rm -f $(PID_FILE)
	@rm -rf tmp/
	@echo "$(GREEN)[clean]$(RESET) 临时文件已清理"
	@echo "$(CYAN)[clean]$(RESET) 保留 ./data 目录及其下所有文件"
