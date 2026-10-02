package services

import "testing"

// 内容指纹应与条目顺序无关、对首尾空白不敏感。
func TestContentSignature(t *testing.T) {
	a := []ItemSignature{
		{Name: "肌酐", Value: "99", Unit: "μmol/L"},
		{Name: "尿素", Value: "5.30", Unit: "mmol/L"},
	}
	b := []ItemSignature{
		{Name: " 尿素 ", Value: "5.30", Unit: "mmol/L"},
		{Name: "肌酐", Value: "99 ", Unit: "μmol/L"},
	}
	if ContentSignature(a) != ContentSignature(b) {
		t.Fatal("相同内容不同顺序/空白的指纹应一致")
	}

	c := []ItemSignature{
		{Name: "肌酐", Value: "100", Unit: "μmol/L"},
		{Name: "尿素", Value: "5.30", Unit: "mmol/L"},
	}
	if ContentSignature(a) == ContentSignature(c) {
		t.Fatal("数值不同的指纹应不同")
	}

	// 条目数不同（多一条）指纹必须不同
	d := append(append([]ItemSignature{}, a...), ItemSignature{Name: "尿酸", Value: "384", Unit: "μmol/L"})
	if ContentSignature(a) == ContentSignature(d) {
		t.Fatal("条目数不同的指纹应不同")
	}
}

// 【2026-10-02 加固后的新行为】OCR 噪声差异不应导致漏拦。
func TestContentSignatureNormalization(t *testing.T) {
	base := []ItemSignature{
		{Name: "肌酐", Value: "99", Unit: "μmol/L"},
		{Name: "尿素", Value: "5.30", Unit: "mmol/L"},
	}

	// 1) 多出一行全空白噪声（OCR 常见）→ 指纹必须一致，否则会漏拦
	withNoise := append(append([]ItemSignature{}, base...), ItemSignature{Name: "  ", Value: "", Unit: "\t"})
	if ContentSignature(base) != ContentSignature(withNoise) {
		t.Fatal("全空白噪声行不应改变指纹（否则重复导入会漏拦）")
	}

	// 2) 名称内部空格 / 单位大小写差异 → 指纹一致
	//    注意：归一化只做「去空白 + 转小写」，不做希腊字母与拉丁字母互转
	//    （μ vs u 字形相似但语义不同，强行等价有误拦风险）。
	variant := []ItemSignature{
		{Name: "肌 酐", Value: "99", Unit: "μMOL/L"},
		{Name: "尿素", Value: "5.30", Unit: "MMOL/L"},
	}
	if ContentSignature(base) != ContentSignature(variant) {
		t.Fatal("名称空格与单位大小写差异不应改变指纹")
	}

	// 3) 数值的等价写法**不**做归一化：1.5 与 1.50 视为不同，
	//    避免把用户手工修正过的值误判为重复报告。
	x := []ItemSignature{{Name: "钾", Value: "1.5", Unit: "mmol/L"}}
	y := []ItemSignature{{Name: "钾", Value: "1.50", Unit: "mmol/L"}}
	if ContentSignature(x) == ContentSignature(y) {
		t.Fatal("数值等价写法不应被归一化（否则会误拦用户修正过的报告）")
	}
}

// 【P0 回归测试】标本前缀守卫必须双向生效。
// 历史 bug：只检查输入侧，导致 idx.Match("白细胞") 命中「尿白细胞」。
func TestContainsMatchAllowedSpecimenPrefix(t *testing.T) {
	cases := []struct {
		input, std string
		want       bool
		why        string
	}{
		// 必须拒绝：标准名带标本前缀而输入不带（本次修复的核心）
		{"白细胞", "尿白细胞", false, "血常规白细胞不应吸附到尿白细胞"},
		{"球蛋白", "尿免疫球蛋白IgG", false, "血清球蛋白不应吸附到尿液免疫球蛋白"},
		{"视黄醇结合蛋白", "尿视黄醇结合蛋白", false, "血清RBP不应吸附到尿RBP"},
		{"钙卫蛋白", "粪钙卫蛋白", false, "标本类型不同"},
		{"钾", "尿钾", false, "血清钾不应吸附到尿钾"},

		// 必须拒绝：输入带标本前缀而标准名不带（原有行为，不能回退）
		{"尿肌酐", "肌酐", false, "尿液肌酐与血清肌酐量级不同"},
		{"24小时尿钾", "尿钾", false, "24小时尿与随机尿取值不同"},

		// 必须放行：同标本、同语义的省略/全称写法
		{"白细胞", "白细胞计数", true, "血常规省略「计数」"},
		{"红细胞", "红细胞计数", true, "血常规省略「计数」"},
		{"总钙", "钙", true, "总钙即血清钙（曾误杀，必须放行）"},
		{"尿白细胞", "尿白细胞计数", true, "同标本"},

		// 必须拒绝：语义限定词只在单侧出现
		{"糖化血红蛋白A1c", "血红蛋白", false, "糖化血红蛋白≠血红蛋白"},
		{"离子钙", "钙", false, "离子钙≠总钙"},
		{"C反应蛋白", "超敏C反应蛋白", false, "hs-CRP≠CRP"},
		{"脂蛋白a", "载脂蛋白A1", false, "Lp(a)≠ApoA1"},
		{"降钙素", "钙", false, "降钙素≠钙"},
		{"尿素氮/肌酐", "肌酐", false, "比值≠单项"},
		{"非高密度脂蛋白胆固醇", "高密度脂蛋白胆固醇", false, "否定前缀"},
		{"磷", "碱性磷酸酶", false, "单字符输入过于模糊"},

		// 必须放行：两侧语义限定词一致
		{"载脂蛋白B/A1", "载脂蛋白B/A1比值", true, "同义全称"},
		{"前白蛋白", "前白蛋白", true, "完全一致"},
	}
	for _, c := range cases {
		if got := containsMatchAllowed(c.input, c.std); got != c.want {
			t.Errorf("containsMatchAllowed(%q, %q) = %v, want %v —— %s", c.input, c.std, got, c.want, c.why)
		}
	}
}

// 【P1 回归测试】包含匹配在长度并列时必须按 id 兜底，不随候选顺序漂移。
func TestTestItemIndexMatchDeterministicTieBreak(t *testing.T) {
	// 两个候选长度相同（5 字），id 不同；两种排列都必须选 id 较小者。
	// 历史 bug：结果依赖候选加载顺序——DB 版走索引得到名称序 → 误取「红细胞压积」。
	ordered := &TestItemIndex{
		Candidates: []TestItemCandidate{
			{ID: 31, Name: "红细胞计数"},
			{ID: 33, Name: "红细胞压积"},
		},
		aliasMap:     map[string]int64{},
		categoryByID: map[int64]string{},
	}
	if got := ordered.Match("红细胞"); got != 31 {
		t.Errorf("候选正序时 Match(红细胞) = %d, want 31", got)
	}

	reversed := &TestItemIndex{
		Candidates: []TestItemCandidate{
			{ID: 33, Name: "红细胞压积"},
			{ID: 31, Name: "红细胞计数"},
		},
		aliasMap:     map[string]int64{},
		categoryByID: map[int64]string{},
	}
	if got := reversed.Match("红细胞"); got != 31 {
		t.Errorf("候选逆序时 Match(红细胞) = %d, want 31（必须按 id 兜底）", got)
	}
}

// 别名（第 2 级精确匹配）必须优先于包含匹配（第 5 级），
// 这是「尿常规省略尿字」写法能正常映射的前提。
func TestTestItemIndexAliasBeatsContains(t *testing.T) {
	idx := &TestItemIndex{
		Candidates: []TestItemCandidate{
			{ID: 20, Name: "白细胞计数"},
			{ID: 222, Name: "尿白细胞"},
			{ID: 213, Name: "尿比重"},
		},
		aliasMap:     map[string]int64{"比重": 213},
		categoryByID: map[int64]string{},
	}
	if got := idx.Match("比重"); got != 213 {
		t.Errorf("Match(比重) = %d, want 213（应走别名）", got)
	}
	if got := idx.Match("白细胞"); got != 20 {
		t.Errorf("Match(白细胞) = %d, want 20（不应被尿白细胞抢走）", got)
	}
	if got := idx.Match("尿白细胞"); got != 222 {
		t.Errorf("Match(尿白细胞) = %d, want 222", got)
	}
}
