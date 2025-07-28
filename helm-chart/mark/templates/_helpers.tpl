{{/*
Expand the name of the chart.
*/}}
{{- define "mark.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
We truncate at 63 chars because some Kubernetes name fields are limited to this (by the DNS naming spec).
If release name contains chart name it will be used as a full name.
*/}}
{{- define "mark.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Create chart name and version as used by the chart label.
*/}}
{{- define "mark.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "mark.labels" -}}
helm.sh/chart: {{ include "mark.chart" . }}
{{ include "mark.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "mark.selectorLabels" -}}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Create the name of the service account to use
*/}}
{{- define "mark.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "mark.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}


{{/*
###############################
api-gateway helpers
###############################
*/}}

{{/*
Expand the name of the service
*/}}
{{- define "mark.api-gateway.name" -}}
{{- printf "%s-%s" (include "mark.fullname" .) "api-gateway" | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "mark.api-gateway.labels" -}}
app.kubernetes.io/name: {{ include "mark.api-gateway.name" . }}
{{ include "mark.selectorLabels" . }}
{{- end }}

{{/*
###############################
api helpers
###############################
*/}}

{{/*
Expand the name of the service
*/}}
{{- define "mark.api.name" -}}
{{- printf "%s-%s" (include "mark.fullname" .) "api" | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "mark.api.labels" -}}
app.kubernetes.io/name: {{ include "mark.api.name" . }}
kubectl.kubernetes.io/default-container: {{ include "mark.api.name" . }}
{{ include "mark.selectorLabels" . }}
{{- end }}

{{/*
###############################
ui helpers
###############################
*/}}

{{/*
Expand the name of the service
*/}}
{{- define "mark.ui.name" -}}
{{- printf "%s-%s" (include "mark.fullname" .) "ui" | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "mark.ui.labels" -}}
app.kubernetes.io/name: {{ include "mark.ui.name" . }}
kubectl.kubernetes.io/default-container: {{ include "mark.ui.name" . }}
{{ include "mark.selectorLabels" . }}
{{- end }}

{{/*
###############################
lti-credentials-manager helpers
###############################
*/}}

{{/*
Expand the name of the service
*/}}
{{- define "mark.lti-credentials-manager.name" -}}
{{- printf "%s-%s" (include "mark.fullname" .) "lti-credentials-manager" | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "mark.lti-credentials-manager.labels" -}}
app.kubernetes.io/name: {{ include "mark.lti-credentials-manager.name" . }}
kubectl.kubernetes.io/default-container: {{ include "mark.lti-credentials-manager.name" . }}
{{ include "mark.selectorLabels" . }}
{{- end }}

{{/*
Ingress labels
*/}}
{{- define "mark.ingress.name" -}}
{{- printf "%s-%s" (include "mark.fullname" .) "ingress" | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "mark.ingress.labels" -}}
app.kubernetes.io/name: {{ include "mark.ingress.name" . }}
{{ include "mark.selectorLabels" . }}
{{- end }}


{{/*
Private ingress labels
*/}}
{{- define "mark.private-ingress.name" -}}
{{- printf "%s-%s" (include "mark.fullname" .) "private-ingress" | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "mark.private-ingress.labels" -}}
app.kubernetes.io/name: {{ include "mark.private-ingress.name" . }}
{{ include "mark.selectorLabels" . }}
{{- end }}

{{/*
Topology spread constraints to schedule pods across AZs
*/}}
{{- define "mark.lti-credentials-manager.topologySpreadConstraints" -}}
- maxSkew: 1
  topologyKey: topology.kubernetes.io/zone
  whenUnsatisfiable: ScheduleAnyway
  labelSelector:
    matchLabels:
    {{- include "mark.lti-credentials-manager.labels" . | nindent 6 }}
- maxSkew: 1
  topologyKey: kubernetes.io/hostname
  whenUnsatisfiable: ScheduleAnyway
  labelSelector:
    matchLabels:
    {{- include "mark.lti-credentials-manager.labels" . | nindent 6 }}
{{- end }}

{{/*
Image pull secrets
*/}}
{{- define "mark.imagePullSecrets" -}}
{{- range .Values.global.imagePullSecrets }}
  - name: {{ .name }}
{{- end }}
{{- end }}

{{/*
storage volume annotations
*/}}
{{- define "mark.storage-volume.annotations" -}}
"helm.sh/hook": pre-install
"helm.sh/hook-weight": "-15"
{{- end }}

{{/*
prereq/install first annotations
*/}}
{{- define "mark.install-first.annotations" -}}
"helm.sh/hook": pre-install,pre-upgrade
"helm.sh/hook-weight": "-10"
{{- end }}

{{/*
Migration annotations
*/}}
{{- define "mark.migrations.annotations" -}}
"helm.sh/hook": pre-install,pre-upgrade
"helm.sh/hook-weight": "-5"
{{- end }}

