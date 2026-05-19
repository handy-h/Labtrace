package database

import "database/sql"

func migrate(db *sql.DB) error {
	ddl := `
	CREATE TABLE IF NOT EXISTS subjects (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		name TEXT NOT NULL,
		gender TEXT NOT NULL CHECK(gender IN ('男','女')),
		birth_date TEXT NOT NULL,
		created_at TEXT NOT NULL DEFAULT (datetime('now')),
		updated_at TEXT NOT NULL DEFAULT (datetime('now'))
	);

	CREATE TABLE IF NOT EXISTS hospitals (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		name TEXT NOT NULL UNIQUE,
		created_at TEXT NOT NULL DEFAULT (datetime('now'))
	);

	CREATE TABLE IF NOT EXISTS test_items (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		code TEXT NOT NULL UNIQUE,
		standard_name TEXT NOT NULL,
		category TEXT NOT NULL DEFAULT '',
		default_unit TEXT NOT NULL DEFAULT '',
		value_type TEXT NOT NULL DEFAULT 'numeric' CHECK(value_type IN ('numeric','titer','qualitative')),
		created_at TEXT NOT NULL DEFAULT (datetime('now'))
	);

	CREATE TABLE IF NOT EXISTS test_item_aliases (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		test_item_id INTEGER NOT NULL REFERENCES test_items(id) ON DELETE CASCADE,
		hospital_id INTEGER REFERENCES hospitals(id) ON DELETE SET NULL,
		alias_name TEXT NOT NULL,
		created_at TEXT NOT NULL DEFAULT (datetime('now'))
	);

	CREATE TABLE IF NOT EXISTS reference_intervals (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		test_item_id INTEGER NOT NULL REFERENCES test_items(id) ON DELETE CASCADE,
		gender TEXT NOT NULL DEFAULT '不限' CHECK(gender IN ('男','女','不限')),
		age_min REAL,
		age_max REAL,
		age_unit TEXT NOT NULL DEFAULT '岁' CHECK(age_unit IN ('岁','天')),
		value_min REAL,
		value_max REAL,
		value_type TEXT NOT NULL DEFAULT 'numeric' CHECK(value_type IN ('numeric','titer','qualitative')),
		qualitative_value TEXT DEFAULT '',
		created_at TEXT NOT NULL DEFAULT (datetime('now'))
	);

	CREATE TABLE IF NOT EXISTS unit_conversions (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		test_item_id INTEGER NOT NULL REFERENCES test_items(id) ON DELETE CASCADE,
		source_unit TEXT NOT NULL,
		target_unit TEXT NOT NULL,
		formula TEXT NOT NULL,
		example_input REAL NOT NULL DEFAULT 0,
		example_output REAL NOT NULL DEFAULT 0,
		created_at TEXT NOT NULL DEFAULT (datetime('now'))
	);

	CREATE TABLE IF NOT EXISTS calculation_rules (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		name TEXT NOT NULL,
		formula TEXT NOT NULL,
		threshold REAL NOT NULL DEFAULT 1.0,
		test_item_ids TEXT NOT NULL DEFAULT '[]',
		created_at TEXT NOT NULL DEFAULT (datetime('now'))
	);

	CREATE TABLE IF NOT EXISTS lab_reports (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
		hospital_id INTEGER REFERENCES hospitals(id) ON DELETE SET NULL,
		sample_date TEXT NOT NULL,
		file_path TEXT NOT NULL DEFAULT '',
		file_md5 TEXT NOT NULL DEFAULT '',
		ocr_status TEXT NOT NULL DEFAULT 'pending' CHECK(ocr_status IN ('pending','processing','review','imported','failed')),
		ocr_raw_json TEXT NOT NULL DEFAULT '',
		whole_report_notes TEXT NOT NULL DEFAULT '',
		created_at TEXT NOT NULL DEFAULT (datetime('now'))
	);
	CREATE UNIQUE INDEX IF NOT EXISTS idx_reports_md5 ON lab_reports(file_md5) WHERE file_md5 != '';

	CREATE TABLE IF NOT EXISTS report_items (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		report_id INTEGER NOT NULL REFERENCES lab_reports(id) ON DELETE CASCADE,
		test_item_id INTEGER REFERENCES test_items(id) ON DELETE SET NULL,
		original_value TEXT NOT NULL DEFAULT '',
		normalized_value REAL,
		original_unit TEXT NOT NULL DEFAULT '',
		normalized_unit TEXT NOT NULL DEFAULT '',
		confidence INTEGER NOT NULL DEFAULT 100 CHECK(confidence >= 0 AND confidence <= 100),
		ref_interval_id INTEGER REFERENCES reference_intervals(id) ON DELETE SET NULL,
		flag TEXT NOT NULL DEFAULT '' CHECK(flag IN ('','H','L','阳性','阴性','normal')),
		row_notes TEXT NOT NULL DEFAULT '',
		ocr_bbox TEXT NOT NULL DEFAULT '',
		created_at TEXT NOT NULL DEFAULT (datetime('now'))
	);

	CREATE TABLE IF NOT EXISTS hospital_rules (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		hospital_id INTEGER NOT NULL REFERENCES hospitals(id) ON DELETE CASCADE,
		rule_name TEXT NOT NULL DEFAULT '',
		column_mappings TEXT NOT NULL DEFAULT '{}',
		created_at TEXT NOT NULL DEFAULT (datetime('now')),
		updated_at TEXT NOT NULL DEFAULT (datetime('now'))
	);

	CREATE TABLE IF NOT EXISTS backups (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		filename TEXT NOT NULL,
		description TEXT NOT NULL DEFAULT '',
		file_size INTEGER NOT NULL DEFAULT 0,
		created_at TEXT NOT NULL DEFAULT (datetime('now'))
	);

	CREATE TABLE IF NOT EXISTS audit_logs (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		action TEXT NOT NULL,
		action_label TEXT NOT NULL DEFAULT '',
		entity_type TEXT NOT NULL DEFAULT '',
		entity_id INTEGER NOT NULL DEFAULT 0,
		details TEXT NOT NULL DEFAULT '{}',
		created_at TEXT NOT NULL DEFAULT (datetime('now'))
	);

	CREATE TABLE IF NOT EXISTS ocr_quotas (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		year_month TEXT NOT NULL UNIQUE,
		total_quota INTEGER NOT NULL DEFAULT 200,
		used_count INTEGER NOT NULL DEFAULT 0,
		success_count INTEGER NOT NULL DEFAULT 0,
		fail_count INTEGER NOT NULL DEFAULT 0,
		created_at TEXT NOT NULL DEFAULT (datetime('now')),
		updated_at TEXT NOT NULL DEFAULT (datetime('now'))
	);

	CREATE TABLE IF NOT EXISTS imaging_report_types (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		code TEXT NOT NULL UNIQUE,
		name TEXT NOT NULL,
		name_en TEXT NOT NULL DEFAULT '',
		description TEXT NOT NULL DEFAULT '',
		sort_order INTEGER NOT NULL DEFAULT 0,
		created_at TEXT NOT NULL DEFAULT (datetime('now'))
	);

	CREATE TABLE IF NOT EXISTS imaging_reports (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
		hospital_id INTEGER REFERENCES hospitals(id) ON DELETE SET NULL,
		report_type TEXT NOT NULL DEFAULT 'OTHER' CHECK(report_type IN ('CT','MRI','XRAY','ULTRASOUND','ECG','OTHER')),
		exam_item_name TEXT NOT NULL DEFAULT '',
		inspect_no TEXT NOT NULL DEFAULT '',
		sample_date TEXT NOT NULL,
		exam_site TEXT NOT NULL DEFAULT '',
		exam_description TEXT NOT NULL DEFAULT '',
		diagnosis_result TEXT NOT NULL DEFAULT '',
		file_path TEXT NOT NULL DEFAULT '',
		file_md5 TEXT NOT NULL DEFAULT '',
		ocr_raw_json TEXT NOT NULL DEFAULT '',
		ocr_status TEXT NOT NULL DEFAULT 'pending' CHECK(ocr_status IN ('pending','processing','review','imported','failed')),
		thumbnail_path TEXT NOT NULL DEFAULT '',
		created_at TEXT NOT NULL DEFAULT (datetime('now')),
		updated_at TEXT NOT NULL DEFAULT (datetime('now'))
	);
	CREATE UNIQUE INDEX IF NOT EXISTS idx_imaging_reports_md5 ON imaging_reports(file_md5) WHERE file_md5 != '';
	`

	_, err := db.Exec(ddl)
	if err != nil {
		return err
	}

	// Add missing columns via ALTER TABLE (SQLite safe — ignores error if column exists)
	alterStmts := []string{
		`ALTER TABLE report_items ADD COLUMN test_item_name TEXT NOT NULL DEFAULT ''`,
		`ALTER TABLE report_items ADD COLUMN ref_interval_text TEXT NOT NULL DEFAULT ''`,
		`ALTER TABLE lab_reports ADD COLUMN column_mapping_json TEXT NOT NULL DEFAULT ''`,
		`ALTER TABLE lab_reports ADD COLUMN ocr_table_json TEXT NOT NULL DEFAULT ''`,
		`ALTER TABLE hospitals ADD COLUMN level TEXT NOT NULL DEFAULT ''`,
		`ALTER TABLE report_items ADD COLUMN category TEXT NOT NULL DEFAULT ''`,
		`ALTER TABLE audit_logs ADD COLUMN action_label TEXT NOT NULL DEFAULT ''`,
		`ALTER TABLE lab_reports ADD COLUMN categories TEXT NOT NULL DEFAULT ''`,
		`ALTER TABLE imaging_reports ADD COLUMN mapping_config_json TEXT NOT NULL DEFAULT ''`,
		`ALTER TABLE hospital_rules ADD COLUMN rule_type TEXT NOT NULL DEFAULT 'lab_mapping'`,
	}
	for _, stmt := range alterStmts {
		db.Exec(stmt) // Ignore error — column may already exist
	}

	return nil
}
