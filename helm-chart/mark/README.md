# Mark Helm Chart

## Introduction

This chart deploys Mark, a comprehensive educational platform for assignment management and grading, on a Kubernetes cluster using the Helm package manager.

## Prerequisites

- Kubernetes 1.19+
- Helm 3.4+
- PV provisioner support in the underlying infrastructure (if persistence is enabled)

## Installing the Chart

To install the chart with the release name `my-mark`:

```bash
helm install my-mark mark/
```

The command deploys Mark on the Kubernetes cluster in the default configuration. The [Parameters](#parameters) section lists the parameters that can be configured during installation.

## Uninstalling the Chart

To uninstall/delete the `my-mark` deployment:

```bash
helm delete my-mark
```

## Parameters

### Global Parameters

| Name | Description | Value |
|------|-------------|-------|
| `global.imagePullSecrets` | Global Docker registry secret names as an array | `[{name: "icr-global"}]` |
| `nameOverride` | String to partially override common.names.fullname | `""` |
| `fullnameOverride` | String to fully override common.names.fullname | `""` |

### API Gateway Parameters

| Name | Description | Value |
|------|-------------|-------|
| `apiGateway.enabled` | Enable API Gateway deployment | `true` |
| `apiGateway.replicaCount` | Number of API Gateway replicas to deploy | `3` |
| `apiGateway.image.repository` | API Gateway image repository | `icr.io/skills-network/mark-api-gateway` |
| `apiGateway.image.tag` | API Gateway image tag (immutable tags are recommended) | `""` |
| `apiGateway.image.pullPolicy` | API Gateway image pull policy | `IfNotPresent` |
| `apiGateway.containerPort` | API Gateway container port | `3000` |
| `apiGateway.service.type` | API Gateway service type | `ClusterIP` |
| `apiGateway.service.port` | API Gateway service HTTP port | `80` |
| `apiGateway.resources.limits` | The resources limits for the API Gateway containers | `{}` |
| `apiGateway.resources.requests` | The requested resources for the API Gateway containers | `{}` |
| `apiGateway.autoscaling.enabled` | Enable autoscaling for API Gateway | `false` |
| `apiGateway.autoscaling.minReplicas` | Minimum number of API Gateway replicas | `1` |
| `apiGateway.autoscaling.maxReplicas` | Maximum number of API Gateway replicas | `100` |
| `apiGateway.autoscaling.targetCPUUtilizationPercentage` | Target CPU utilization percentage | `80` |
| `apiGateway.livenessProbe.initialDelaySeconds` | Initial delay seconds for livenessProbe | `10` |
| `apiGateway.livenessProbe.timeoutSeconds` | Timeout seconds for livenessProbe | `1` |
| `apiGateway.livenessProbe.periodSeconds` | Period seconds for livenessProbe | `15` |
| `apiGateway.readinessProbe.initialDelaySeconds` | Initial delay seconds for readinessProbe | `10` |
| `apiGateway.readinessProbe.timeoutSeconds` | Timeout seconds for readinessProbe | `1` |
| `apiGateway.readinessProbe.periodSeconds` | Period seconds for readinessProbe | `15` |
| `apiGateway.env` | Environment variables for API Gateway | `{API_GATEWAY_PORT: 3000}` |
| `apiGateway.secretEnv` | Secret environment variables for API Gateway | `{}` |

### Core API Parameters

| Name | Description | Value |
|------|-------------|-------|
| `api.enabled` | Enable Core API deployment | `true` |
| `api.replicaCount` | Number of Core API replicas to deploy | `3` |
| `api.image.repository` | Core API image repository | `icr.io/skills-network/mark-api` |
| `api.image.tag` | Core API image tag (immutable tags are recommended) | `""` |
| `api.image.pullPolicy` | Core API image pull policy | `IfNotPresent` |
| `api.containerPort` | Core API container port | `3001` |
| `api.service.type` | Core API service type | `ClusterIP` |
| `api.service.port` | Core API service HTTP port | `80` |
| `api.resources.limits` | The resources limits for the Core API containers | `{}` |
| `api.resources.requests` | The requested resources for the Core API containers | `{}` |
| `api.autoscaling.enabled` | Enable autoscaling for Core API | `false` |
| `api.autoscaling.minReplicas` | Minimum number of Core API replicas | `1` |
| `api.autoscaling.maxReplicas` | Maximum number of Core API replicas | `100` |
| `api.autoscaling.targetCPUUtilizationPercentage` | Target CPU utilization percentage | `80` |
| `api.livenessProbe.initialDelaySeconds` | Initial delay seconds for livenessProbe | `30` |
| `api.livenessProbe.timeoutSeconds` | Timeout seconds for livenessProbe | `5` |
| `api.livenessProbe.periodSeconds` | Period seconds for livenessProbe | `15` |
| `api.readinessProbe.initialDelaySeconds` | Initial delay seconds for readinessProbe | `10` |
| `api.readinessProbe.timeoutSeconds` | Timeout seconds for readinessProbe | `3` |
| `api.readinessProbe.periodSeconds` | Period seconds for readinessProbe | `10` |
| `api.env` | Environment variables for Core API | `{API_PORT: 3001}` |
| `api.secretEnv` | Secret environment variables for Core API | `{}` |

### Web UI Parameters

| Name | Description | Value |
|------|-------------|-------|
| `ui.enabled` | Enable Web UI deployment | `true` |
| `ui.replicaCount` | Number of Web UI replicas to deploy | `3` |
| `ui.image.repository` | Web UI image repository | `icr.io/skills-network/mark-ui` |
| `ui.image.tag` | Web UI image tag (immutable tags are recommended) | `""` |
| `ui.image.pullPolicy` | Web UI image pull policy | `IfNotPresent` |
| `ui.containerPort` | Web UI container port | `3000` |
| `ui.service.type` | Web UI service type | `ClusterIP` |
| `ui.service.port` | Web UI service HTTP port | `80` |
| `ui.resources.limits` | The resources limits for the Web UI containers | `{}` |
| `ui.resources.requests` | The requested resources for the Web UI containers | `{}` |
| `ui.autoscaling.enabled` | Enable autoscaling for Web UI | `false` |
| `ui.autoscaling.minReplicas` | Minimum number of Web UI replicas | `1` |
| `ui.autoscaling.maxReplicas` | Maximum number of Web UI replicas | `100` |
| `ui.autoscaling.targetCPUUtilizationPercentage` | Target CPU utilization percentage | `80` |
| `ui.livenessProbe.initialDelaySeconds` | Initial delay seconds for livenessProbe | `10` |
| `ui.livenessProbe.timeoutSeconds` | Timeout seconds for livenessProbe | `1` |
| `ui.livenessProbe.periodSeconds` | Period seconds for livenessProbe | `15` |
| `ui.readinessProbe.initialDelaySeconds` | Initial delay seconds for readinessProbe | `10` |
| `ui.readinessProbe.timeoutSeconds` | Timeout seconds for readinessProbe | `1` |
| `ui.readinessProbe.periodSeconds` | Period seconds for readinessProbe | `15` |
| `ui.env` | Environment variables for Web UI | `{PORT: 3000}` |
| `ui.secretEnv` | Secret environment variables for Web UI | `{}` |

### Ingress Parameters

| Name | Description | Value |
|------|-------------|-------|
| `ingress.enabled` | Enable ingress record generation for Mark | `false` |
| `ingress.className` | IngressClass that will be be used to implement the Ingress | `""` |
| `ingress.annotations` | Additional annotations for the Ingress resource | `{}` |
| `ingress.hosts` | An array with hosts and paths | `[{host: "mark.local", paths: [{path: "/", pathType: "Prefix"}]}]` |
| `ingress.tls` | TLS configuration for Mark ingress | `[]` |

### LTI Gateway Parameters

| Name | Description | Value |
|------|-------------|-------|
| `lti-gateway.replicaCount` | Number of LTI Gateway replicas to deploy | `3` |
| `lti-gateway.resources.limits` | The resources limits for the LTI Gateway containers | `{}` |
| `lti-gateway.resources.requests` | The requested resources for the LTI Gateway containers | `{}` |
| `lti-gateway.secretEnv` | Secret environment variables for LTI Gateway | `{}` |
| `lti-gateway.ltiCredentials` | LTI credentials configuration | `{}` |
| `lti-gateway.jwtCredentials` | JWT credentials configuration | `{}` |
| `lti-gateway.imagePullSecrets` | Image pull secrets for LTI Gateway | `[{name: "icr-global"}]` |

### Common sn-common Parameters

| Name | Description | Value |
|------|-------------|-------|
| `sn-common.*` | Parameters from sn-common dependency chart | See [sn-common documentation] |

## Configuration and Installation Details

### External Database

By default, Mark uses an embedded database configuration through its dependencies. However, for production deployments, it's recommended to use an external database.

To use an external PostgreSQL database:

```yaml
externalDatabase:
  enabled: true
  host: "postgresql.example.com"
  port: 5432
  database: "mark"
  username: "mark_user"
  existingSecret: "mark-db-secret" # pragma: allowlist secret
  existingSecretPasswordKey: "password" # pragma: allowlist secret
```

### Persistence

Mark supports persistent storage for data that needs to survive pod restarts. Configure persistence in the values:

```yaml
persistence:
  enabled: true
  storageClass: "fast-ssd"
  accessMode: ReadWriteOnce
  size: 10Gi
```

### Security

#### Pod Security Context

Configure security context for enhanced security:

```yaml
securityContext:
  runAsNonRoot: true
  runAsUser: 1000
  fsGroup: 1000
```

#### Network Policies

Enable network policies to restrict traffic:

```yaml
networkPolicies:
  enabled: true
```

### Monitoring

Mark includes monitoring capabilities with Prometheus integration:

```yaml
monitoring:
  enabled: true
  serviceMonitor:
    enabled: true
    interval: 30s
```

### Backup

Configure automated backups:

```yaml
backup:
  enabled: true
  schedule: "0 2 * * *"  # Daily at 2 AM
  retention: "30d"
```

## Common Configuration Examples

### Development Environment

```yaml
replicaCount: 1
resources:
  requests:
    memory: "256Mi"
    cpu: "100m"
ingress:
  enabled: true
  hosts:
    - host: mark.dev.local
```

### Production Environment

```yaml
replicaCount: 5
resources:
  requests:
    memory: "512Mi"
    cpu: "200m"
  limits:
    memory: "1Gi"
    cpu: "1000m"
autoscaling:
  enabled: true
  minReplicas: 3
  maxReplicas: 10
ingress:
  enabled: true
  annotations:
    cert-manager.io/cluster-issuer: "letsencrypt-prod"
  tls:
    - secretName: mark-tls
      hosts:
        - mark.example.com
```

## Troubleshooting

### Common Issues

1. **Pods not starting**: Check resource requests and limits
2. **Database connection issues**: Verify database configuration and secrets
3. **Ingress not working**: Check ingress controller and DNS configuration

### Debug Commands

```bash
# Check pod status
kubectl get pods -l app.kubernetes.io/name=mark

# Check logs
kubectl logs -l app.kubernetes.io/name=mark -c api-gateway

# Describe deployment
kubectl describe deployment mark-api-gateway
```

## License

This chart is licensed under the MIT License.