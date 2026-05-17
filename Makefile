# LabTrace Makefile
# =================

# 项目名称（与 go.mod module 名一致）
APP_NAME    := labtrace

# 从 .env 读取端口，默认 8080
PORT        := $(shell grep '^PORT=' .env 2>/dev/null | sed 's/^PORT=//' || echo 8080)

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

.PHONY: build dev run stop clean help rebuild restart test lint

# ---- 默认目标 ----
help: ## 显示帮助信息
	@printf "$(CYAN)LabTrace Makefile$(RESET)\n"
	@printf "==================\n\n"
	@printf "$(GREEN)Usage:$(RESET) make <target>\n\n"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  $(GREEN)%-10s$(RESET) %s\n", $$1, $$2}'
	@printf "\n"

build: ## 编译生成可执行二进制文件
	@printf "$(CYAN)[build]$(RESET) 编译 $(APP_NAME)...\n"
	@CGO_ENABLED=1 $(GO) build -ldflags "$(LDFLAGS)" -o $(APP_NAME) .
	@printf "$(GREEN)[build]$(RESET) 编译完成: ./$(APP_NAME)\n"

dev: ## 开发者模式运行（丰富日志）
	@bash -c ' \
		if [ -f $(PID_FILE) ]; then \
			printf "$(YELLOW)[dev]$(RESET) 检测到 PID 文件，尝试先停止旧进程...\n"; \
			$(MAKE) --no-print-directory stop; \
		fi; \
		printf "$(CYAN)[dev]$(RESET) 以开发者模式启动...\n"; \
		GIN_MODE=debug ./$(APP_NAME) 2>&1 | tee -a dev.log & \
		DEV_PID=$$!; \
		echo $$DEV_PID > $(PID_FILE); \
		sleep 1; \
		if kill -0 $$DEV_PID 2>/dev/null; then \
			printf "$(GREEN)[dev]$(RESET) 已启动 (PID: $$DEV_PID, 端口: $(PORT), 日志: dev.log)\n"; \
		else \
			printf "$(RED)[dev]$(RESET) 启动失败，请检查日志\n"; \
			rm -f $(PID_FILE); \
		fi \
	'

run: ## 生产模式运行（仅必要日志）
	@bash -c ' \
		if [ -f $(PID_FILE) ]; then \
			printf "$(YELLOW)[run]$(RESET) 检测到 PID 文件，尝试先停止旧进程...\n"; \
			$(MAKE) --no-print-directory stop; \
		fi; \
		if ! [ -f $(APP_NAME) ]; then \
			printf "$(YELLOW)[run]$(RESET) 二进制文件不存在，先编译...\n"; \
			$(MAKE) build; \
		fi; \
		printf "$(CYAN)[run]$(RESET) 以生产模式启动...\n"; \
		GIN_MODE=release ./$(APP_NAME) & \
		RUN_PID=$$!; \
		echo $$RUN_PID > $(PID_FILE); \
		sleep 1; \
		if kill -0 $$RUN_PID 2>/dev/null; then \
			printf "$(GREEN)[run]$(RESET) 已启动 (PID: $$RUN_PID, 端口: $(PORT))\n"; \
		else \
			printf "$(RED)[run]$(RESET) 启动失败，请检查配置\n"; \
			rm -f $(PID_FILE); \
		fi \
	'

stop: ## 优雅关闭应用
	@bash -c ' \
		printf "$(CYAN)[stop]$(RESET) 正在停止...\n"; \
		if [ -f $(PID_FILE) ]; then \
			PID=$$(cat $(PID_FILE)); \
			if kill -0 $$PID 2>/dev/null; then \
				kill -15 $$PID; \
				printf "$(GREEN)[stop]$(RESET) 已发送 SIGTERM 到进程 $$PID\n"; \
				for i in 1 2 3 4 5; do \
					if ! kill -0 $$PID 2>/dev/null; then \
						printf "$(GREEN)[stop]$(RESET) 进程已退出\n"; \
						rm -f $(PID_FILE); \
						exit 0; \
					fi; \
					sleep 1; \
				done; \
				printf "$(YELLOW)[stop]$(RESET) 进程未在 5 秒内退出，发送 SIGKILL 强制终止\n"; \
				kill -9 $$PID 2>/dev/null; \
				rm -f $(PID_FILE); \
			else \
				printf "$(YELLOW)[stop]$(RESET) PID $$PID 已不存在，清理 PID 文件\n"; \
				rm -f $(PID_FILE); \
			fi; \
		else \
			printf "$(YELLOW)[stop]$(RESET) 未找到 PID 文件\n"; \
		fi; \
		PID_ON_PORT=$$(ss -tlnp "sport = :$(PORT)" 2>/dev/null | sed -n 's/.*pid=\([0-9]\+\).*/\1/p'); \
		if [ -z "$$PID_ON_PORT" ]; then \
			PID_ON_PORT=$$(lsof -ti :$(PORT) 2>/dev/null); \
		fi; \
		if [ -n "$$PID_ON_PORT" ]; then \
			printf "\n"; \
			printf "$(RED)[stop]$(RESET) 端口 $(PORT) 仍被以下进程占用:\n"; \
			PID_INFO=$$(ss -tlnp "sport = :$(PORT)" 2>/dev/null || lsof -i :$(PORT) 2>/dev/null); \
			printf "$$PID_INFO\n"; \
			if [ "$(FORCE)" = "1" ]; then \
				for p in $$PID_ON_PORT; do \
					kill -9 $$p 2>/dev/null; \
					printf "$(GREEN)[stop]$(RESET) 已强制终止进程 $$p\n"; \
				done; \
			else \
				printf "$(YELLOW)[stop]$(RESET) 已跳过，端口 $(PORT) 仍被占用\n"; \
			fi; \
		fi \
	'


test: ## 运行单元测试
	@printf "$(CYAN)[test]$(RESET) 运行测试...\n"
	@$(GO) test -v ./...
	@printf "$(GREEN)[test]$(RESET) 测试完成\n"

lint: ## 代码静态检查
	@printf "$(CYAN)[lint]$(RESET) 运行 go vet...\n"
	@$(GO) vet ./...
	@printf "$(GREEN)[lint]$(RESET) 检查完成\n"

clean: ## 清理临时文件、缓存及二进制文件（保留 ./data 目录）
	@printf "$(CYAN)[clean]$(RESET) 清理编译产物...\n"
	@rm -f $(APP_NAME)
	@printf "$(GREEN)[clean]$(RESET) 已删除二进制文件: $(APP_NAME)\n"
	@printf "$(CYAN)[clean]$(RESET) 清理 Go 缓存...\n"
	@$(GO) clean -cache -testcache -i 2>/dev/null || true
	@printf "$(GREEN)[clean]$(RESET) Go 缓存已清理\n"
	@printf "$(CYAN)[clean]$(RESET) 清理临时文件...\n"
	@rm -f *.log *.out *.test
	@rm -f $(PID_FILE)
	@rm -rf tmp/
	@printf "$(GREEN)[clean]$(RESET) 临时文件已清理\n"
	@printf "$(CYAN)[clean]$(RESET) 保留 ./data 目录及其下所有文件\n"

rebuild: clean build ## 先清理再编译

restart: stop run ## 先停止再启动
