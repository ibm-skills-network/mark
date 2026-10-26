{{/* Release "mark-v3" gives mark-v3-api and mark-v3-worker. */}}
{{- define "mark-v3.fullname" -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "mark-v3.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "mark-v3.commonLabels" -}}
helm.sh/chart: {{ include "mark-v3.chart" . }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/* Selector labels; the instance value is pinned, see values.yaml. */}}
{{- define "mark-v3.selectorLabels" -}}
app.kubernetes.io/instance: {{ .Values.selectorInstance }}
{{- end }}

{{- define "mark-v3.api.name" -}}
{{- printf "%s-api" (include "mark-v3.fullname" .) | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "mark-v3.api.selectorLabels" -}}
app.kubernetes.io/name: {{ include "mark-v3.api.name" . }}
{{ include "mark-v3.selectorLabels" . }}
{{- end }}

{{- define "mark-v3.api.labels" -}}
{{ include "mark-v3.api.selectorLabels" . }}
{{ include "mark-v3.commonLabels" . }}
{{- end }}

{{- define "mark-v3.worker.name" -}}
{{- printf "%s-worker" (include "mark-v3.fullname" .) | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "mark-v3.worker.selectorLabels" -}}
app.kubernetes.io/name: {{ include "mark-v3.worker.name" . }}
{{ include "mark-v3.selectorLabels" . }}
{{- end }}

{{- define "mark-v3.worker.labels" -}}
{{ include "mark-v3.worker.selectorLabels" . }}
{{ include "mark-v3.commonLabels" . }}
{{- end }}

{{- define "mark-v3.databaseUrl" -}}
{{- $v := .Values.postgres -}}
{{- printf "postgresql://%s:%s@%s:%v/%s" $v.username $v.password $v.hostname $v.port $v.dbName }} {{- /* # pragma: allowlist secret */}}
{{- end }}

{{- define "mark-v3.imagePullSecrets" -}}
{{- range .Values.global.imagePullSecrets }}
  - name: {{ .name }}
{{- end }}
{{- end }}
