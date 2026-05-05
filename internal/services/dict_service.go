package services

// qualitativeDict maps non-standard qualitative expressions to standard values.
var qualitativeDict = map[string]string{
	// 阴性 variants
	"Neg":      "阴性(-)",
	"neg":      "阴性(-)",
	"Negative": "阴性(-)",
	"(-)":      "阴性(-)",
	"阴":       "阴性(-)",
	"阴性":      "阴性(-)",
	"-":        "阴性(-)",

	// 阳性 variants
	"Pos":      "阳性(+)",
	"pos":      "阳性(+)",
	"Positive": "阳性(+)",
	"(+)":      "阳性(+)",
	"阳":       "阳性(+)",
	"阳性":      "阳性(+)",
	"+":        "阳性(+)",

	// 弱阳性
	"(±)":  "弱阳性(±)",
	"±":    "弱阳性(±)",

	// 1+ to 4+
	"1+": "1+",
	"2+": "2+",
	"3+": "3+",
	"4+": "4+",
}

// NormalizeQualitative maps a non-standard qualitative expression to its standard value.
// Returns the original value if no mapping exists.
func NormalizeQualitative(value string) string {
	if std, ok := qualitativeDict[value]; ok {
		return std
	}
	return value
}
