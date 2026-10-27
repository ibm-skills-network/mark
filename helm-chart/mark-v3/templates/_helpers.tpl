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

{{/* Used only when secrets.DATABASE_URL is empty. Credentials are percent-encoded (urlquery turns a space into "+", so map it to %20). */}}
{{- define "mark-v3.databaseUrl" -}}
{{- $v := .Values.postgres -}}
{{- $host := required "postgres.hostname is required when secrets.DATABASE_URL is empty" $v.hostname -}}
{{- $user := required "postgres.username is required when secrets.DATABASE_URL is empty" $v.username | toString | urlquery | replace "+" "%20" -}}
{{- $pass := required "postgres.password is required when secrets.DATABASE_URL is empty" $v.password | toString | urlquery | replace "+" "%20" -}}
{{- $params := list -}}
{{- if $v.usePgBouncer -}}
{{- $params = append $params "pgbouncer=true" -}}
{{- end -}}
{{- range $k, $val := $v.extraParams -}}
{{- $params = append $params (printf "%s=%s" ($k | urlquery) ($val | toString | urlquery)) -}}
{{- end -}}
{{- $query := "" -}}
{{- if $params -}}
{{- $query = printf "?%s" (join "&" $params) -}}
{{- end -}}
{{- printf "postgresql://%s:%s@%s:%v/%s%s" $user $pass $host $v.port $v.dbName $query }} {{- /* # pragma: allowlist secret */}}
{{- end }}

{{- define "mark-v3.imagePullSecrets" -}}
{{- range .Values.global.imagePullSecrets }}
  - name: {{ .name }}
{{- end }}
{{- end }}
