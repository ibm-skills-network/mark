{{/*
Resource names match what the mark chart created (release "mark-rust" gives
mark-rust-api and mark-rust-worker), so the release adopts them unchanged.
*/}}
{{- define "mark-rust.fullname" -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "mark-rust.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "mark-rust.commonLabels" -}}
helm.sh/chart: {{ include "mark-rust.chart" . }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/* Selector labels; the instance value is pinned, see values.yaml. */}}
{{- define "mark-rust.selectorLabels" -}}
app.kubernetes.io/instance: {{ .Values.selectorInstance }}
{{- end }}

{{- define "mark-rust.api.name" -}}
{{- printf "%s-api" (include "mark-rust.fullname" .) | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "mark-rust.api.selectorLabels" -}}
app.kubernetes.io/name: {{ include "mark-rust.api.name" . }}
{{ include "mark-rust.selectorLabels" . }}
{{- end }}

{{- define "mark-rust.api.labels" -}}
{{ include "mark-rust.api.selectorLabels" . }}
{{ include "mark-rust.commonLabels" . }}
{{- end }}

{{- define "mark-rust.worker.name" -}}
{{- printf "%s-worker" (include "mark-rust.fullname" .) | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "mark-rust.worker.selectorLabels" -}}
app.kubernetes.io/name: {{ include "mark-rust.worker.name" . }}
{{ include "mark-rust.selectorLabels" . }}
{{- end }}

{{- define "mark-rust.worker.labels" -}}
{{ include "mark-rust.worker.selectorLabels" . }}
{{ include "mark-rust.commonLabels" . }}
{{- end }}

{{/* The TypeScript API's Secret and ConfigMap, for shared settings. */}}
{{- define "mark-rust.api.secretName" -}}
{{- .Values.api.secretName | default (printf "%s-secrets" .Values.api.name) }}
{{- end }}

{{- define "mark-rust.api.configMapName" -}}
{{- .Values.api.configMapName | default (printf "%s-config" .Values.api.name) }}
{{- end }}

{{- define "mark-rust.databaseUrl" -}}
{{- $v := .Values.postgres -}}
{{- printf "postgresql://%s:%s@%s:%v/%s" $v.username $v.password $v.hostname $v.port $v.dbName }}
{{- end }}

{{- define "mark-rust.imagePullSecrets" -}}
{{- range .Values.global.imagePullSecrets }}
  - name: {{ .name }}
{{- end }}
{{- end }}
