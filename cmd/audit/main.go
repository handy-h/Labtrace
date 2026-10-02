// Command audit —— LabTrace 项目映射一致性审计工具。
//
// 用途：在改动匹配规则（internal/services/testitem_service.go）或批量导入/重映射之后，
// 用**只读**方式回放全库的 report_items 名称，验证「数据 ⇒ 规则」是否自洽，
// 并断言若干已知短名陷阱不会复活。退出码非 0 表示存在必须修的问题。
//
// 用法：
//
//	make audit
//	go run ./cmd/audit -db data/labtrace.db
//
// 本工具不写入任何数据（SQLite 以 mode=ro 打开）。
package main

import (
	"database/sql"
	"flag"
	"fmt"
	"os"
	"sort"
	"strings"

	_ "github.com/mattn/go-sqlite3"

	"labtrace/internal/database"
	"labtrace/internal/services"
)

// regressionCases 已知陷阱的回归断言：input 必须映射到 want 标准项目。
// 每一条都对应一次真实踩坑，修改匹配规则时若被打破会立即失败。
var regressionCases = []struct {
	input string
	want  string
	why   string
}{
	{"白细胞", "白细胞计数", "P0：血常规白细胞曾被吸附到「尿白细胞」"},
	{"红细胞", "红细胞计数", "P1：候选顺序漂移曾命中「红细胞压积」"},
	{"血小板", "血小板计数", "P1：候选顺序漂移曾命中「血小板压积」"},
	{"胆红素", "总胆红素", "P1：曾被吸附到「尿胆红素」"},
	{"尿白细胞", "尿白细胞", "尿常规项必须归位到尿项目"},
	{"尿肌酐", "尿肌酐", "尿液肌酐不应落回血清肌酐"},
	{"糖化血红蛋白A1c", "糖化血红蛋白", "曾吸附到「血红蛋白」"},
	{"离子钙", "离子钙", "曾吸附到「钙」（离子钙与总钙量级不同）"},
	{"C反应蛋白", "C反应蛋白", "曾吸附到「超敏C反应蛋白」"},
	{"脂蛋白a", "脂蛋白(a)", "曾吸附到「载脂蛋白A1」（规范名带括号，故走别名）"},
	{"总钙", "钙", "误杀回归点：总钙必须能映射到血清钙"},
	{"尿素氮/肌酐", "尿素氮/肌酐比值", "比值项不应吸附到单项肌酐"},
	{"*尿酸", "尿酸", "装饰字符清理"},
	{"D-二聚体.", "D-二聚体", "装饰字符清理"},
	{"血糖", "葡萄糖", "泛称应落到通用项，不吸附「空腹血糖」"},
}

func main() {
	dbPath := flag.String("db", "data/labtrace.db", "SQLite 数据库路径")
	flag.Parse()

	// 只读打开：审计绝不允许改动生产数据
	db, err := sql.Open("sqlite3", *dbPath+"?_journal_mode=WAL&mode=ro")
	if err != nil {
		fmt.Fprintf(os.Stderr, "打开数据库失败: %v\n", err)
		os.Exit(2)
	}
	defer db.Close()
	if err := db.Ping(); err != nil {
		fmt.Fprintf(os.Stderr, "连接数据库失败: %v\n", err)
		os.Exit(2)
	}
	database.DB = db

	nameByID := map[int64]string{}
	idByName := map[string]int64{}
	rows, err := db.Query(`SELECT id, standard_name FROM test_items ORDER BY id`)
	if err != nil {
		fmt.Fprintf(os.Stderr, "读取 test_items 失败: %v\n", err)
		os.Exit(2)
	}
	for rows.Next() {
		var id int64
		var n string
		if err := rows.Scan(&id, &n); err == nil {
			nameByID[id] = n
			if _, dup := idByName[n]; !dup {
				idByName[n] = id
			}
		}
	}
	rows.Close()

	idx := services.LoadTestItemIndex()

	failCount, warnCount := 0, 0
	fail := func(format string, a ...interface{}) {
		failCount++
		fmt.Printf("  \033[0;31mFAIL\033[0m "+format+"\n", a...)
	}
	warn := func(format string, a ...interface{}) {
		warnCount++
		fmt.Printf("  \033[0;33mWARN\033[0m "+format+"\n", a...)
	}
	ok := func(format string, a ...interface{}) {
		fmt.Printf("  \033[0;32mOK\033[0m   "+format+"\n", a...)
	}

	fmt.Printf("数据库: %s\ntest_items: %d 项\n\n", *dbPath, len(nameByID))

	// ── 1. 字典完整性 ───────────────────────────────────────────────
	fmt.Println("[1] 项目字典完整性")

	dupStd := []string{}
	r1, _ := db.Query(`SELECT standard_name, COUNT(*) c FROM test_items GROUP BY standard_name HAVING c > 1`)
	for r1.Next() {
		var n string
		var c int
		r1.Scan(&n, &c)
		dupStd = append(dupStd, fmt.Sprintf("%s×%d", n, c))
	}
	r1.Close()
	if len(dupStd) > 0 {
		fail("存在重名标准项目 %d 个：%s", len(dupStd), strings.Join(dupStd, ", "))
	} else {
		ok("无重名标准项目")
	}

	dupAlias := []string{}
	r2, _ := db.Query(`SELECT alias_name, COUNT(DISTINCT test_item_id) c FROM test_item_aliases GROUP BY alias_name HAVING c > 1`)
	for r2.Next() {
		var n string
		var c int
		r2.Scan(&n, &c)
		dupAlias = append(dupAlias, n)
	}
	r2.Close()
	if len(dupAlias) > 0 {
		fail("别名一名多主 %d 个：%s", len(dupAlias), strings.Join(dupAlias, ", "))
	} else {
		ok("无别名一名多主")
	}

	shadow := []string{}
	r3, _ := db.Query(`SELECT a.alias_name FROM test_item_aliases a JOIN test_items t ON t.standard_name = a.alias_name WHERE a.test_item_id != t.id`)
	for r3.Next() {
		var n string
		r3.Scan(&n)
		shadow = append(shadow, n)
	}
	r3.Close()
	if len(shadow) > 0 {
		fail("别名遮蔽他人标准名 %d 个（精确匹配会先命中标准名，该别名永不生效）：%s", len(shadow), strings.Join(shadow, ", "))
	} else {
		ok("无别名遮蔽标准名")
	}

	// ── 2. 数据 ↔ 规则一致性（全量回放） ─────────────────────────────
	fmt.Println("\n[2] 数据 ↔ 规则一致性（回放全部 distinct 名称）")

	type pair struct {
		name string
		cur  int64
	}
	r4, err := db.Query(`SELECT DISTINCT test_item_name, COALESCE(test_item_id, 0) FROM report_items WHERE test_item_name != ''`)
	if err != nil {
		fmt.Fprintf(os.Stderr, "读取 report_items 失败: %v\n", err)
		os.Exit(2)
	}
	var pairs []pair
	seen := map[string]bool{}
	for r4.Next() {
		var p pair
		if err := r4.Scan(&p.name, &p.cur); err == nil {
			key := fmt.Sprintf("%s\x00%d", p.name, p.cur)
			if !seen[key] {
				seen[key] = true
				pairs = append(pairs, p)
			}
		}
	}
	r4.Close()

	var nullButMatchable, mappedButRejected, diverged []string
	for _, p := range pairs {
		m := idx.Match(p.name)
		switch {
		case p.cur == 0 && m > 0:
			nullButMatchable = append(nullButMatchable, fmt.Sprintf("%s → %s(#%d)", p.name, nameByID[m], m))
		case p.cur != 0 && m == 0:
			mappedButRejected = append(mappedButRejected, fmt.Sprintf("%s (现挂 #%d %s)", p.name, p.cur, nameByID[p.cur]))
		case p.cur != 0 && m != 0 && p.cur != m:
			diverged = append(diverged, fmt.Sprintf("%s: 现 #%d %s vs 规则 #%d %s", p.name, p.cur, nameByID[p.cur], m, nameByID[m]))
		}
	}
	sort.Strings(nullButMatchable)
	sort.Strings(mappedButRejected)
	sort.Strings(diverged)

	if len(nullButMatchable) > 0 {
		fail("有 %d 个名称未映射但规则可以匹配（应回填）：", len(nullButMatchable))
		for _, s := range nullButMatchable {
			fmt.Println("       " + s)
		}
	} else {
		ok("无「未映射但可匹配」的条目")
	}

	if len(mappedButRejected) > 0 {
		fail("有 %d 个名称已映射但规则会拒绝（残留误映射）：", len(mappedButRejected))
		for _, s := range mappedButRejected {
			fmt.Println("       " + s)
		}
	} else {
		ok("无「已映射但规则拒绝」的条目")
	}

	if len(diverged) > 0 {
		// 人工在映射向导里指定的归属可能与算法不同，属合法覆盖，故只告警
		warn("有 %d 个名称的库内归属与规则结果不同（人工覆盖，请人工确认）：", len(diverged))
		for _, s := range diverged {
			fmt.Println("       " + s)
		}
	} else {
		ok("库内归属与规则结果完全一致")
	}

	// ── 3. 标本前缀短名陷阱 ─────────────────────────────────────────
	fmt.Println("\n[3] 标本前缀短名陷阱（省略标本字的写法必须走别名，不能靠包含匹配）")

	aliasOwner := map[string]int64{}
	r5, _ := db.Query(`SELECT alias_name, test_item_id FROM test_item_aliases`)
	for r5.Next() {
		var a string
		var t int64
		r5.Scan(&a, &t)
		aliasOwner[a] = t
	}
	r5.Close()

	trapCount := 0
	for _, c := range idx.Candidates {
		for _, p := range services.SpecimenPrefixes {
			if !strings.HasPrefix(c.Name, p) {
				continue
			}
			stripped := strings.TrimPrefix(c.Name, p)
			if len([]rune(stripped)) < 2 {
				continue
			}
			if _, hasAlias := aliasOwner[stripped]; hasAlias {
				continue // 已显式登记别名，属有意为之
			}
			if got := idx.Match(stripped); got == c.ID {
				trapCount++
				fail("输入 %q 会被包含匹配吸附到标本类项目 %s(#%d)，且未登记别名", stripped, c.Name, c.ID)
			}
		}
	}
	if trapCount == 0 {
		ok("未发现未登记别名的标本前缀吸附")
	}

	// ── 4. 已知陷阱回归断言 ─────────────────────────────────────────
	fmt.Println("\n[4] 已知陷阱回归断言")

	for _, rc := range regressionCases {
		wantID, exists := idByName[rc.want]
		if !exists {
			warn("跳过 %q：目标标准项目 %q 不存在", rc.input, rc.want)
			continue
		}
		got := idx.Match(rc.input)
		if got != wantID {
			gotName := "未匹配"
			if got > 0 {
				gotName = fmt.Sprintf("%s(#%d)", nameByID[got], got)
			}
			fail("Match(%q) = %s，期望 %s(#%d) —— %s", rc.input, gotName, rc.want, wantID, rc.why)
			continue
		}
	}
	if failCount == 0 {
		ok("%d 条回归断言全部通过", len(regressionCases))
	}

	// ── 汇总 ────────────────────────────────────────────────────────
	fmt.Printf("\n汇总: FAIL=%d  WARN=%d\n", failCount, warnCount)
	if failCount > 0 {
		fmt.Println("存在必须修复的问题。")
		os.Exit(1)
	}
	fmt.Println("审计通过。")
}
