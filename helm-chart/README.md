# Mark Helm Charts

[![Chart Version](https://img.shields.io/badge/Chart%20Version-1.4.0-informational?style=flat-square)](https://github.com/ibm-skills-network/mark/releases)
[![App Version](https://img.shields.io/badge/App%20Version-1.0.0-informational?style=flat-square)](https://github.com/ibm-skills-network/mark/releases)
[![Helm Version](https://img.shields.io/badge/Helm-v3.4%2B-informational?style=flat-square)](https://helm.sh/docs/intro/install/)
[![Kubernetes Version](https://img.shields.io/badge/Kubernetes-1.19%2B-informational?style=flat-square)](https://kubernetes.io/releases/)

Mark is a comprehensive educational platform for assignment management and grading. This repository contains Helm charts to deploy the complete Mark application stack on Kubernetes.

## 🚀 Quick Start

### Prerequisites

- Kubernetes 1.19+
- Helm 3.4+
- PV provisioner support in the underlying infrastructure (for persistent storage)

### Installing the Chart

Add the Mark Helm repository:

```bash
helm repo add mark https://ibm-skills-network.github.io/mark/
helm repo update
```

Install Mark with default configuration:

```bash
helm install my-mark mark/mark
```

Install with custom values:

```bash
helm install my-mark mark/mark -f my-values.yaml
```

### Uninstalling the Chart

```bash
helm uninstall my-mark
```

## 📋 Chart Information

| Field | Value |
|-------|-------|
| Chart Name | mark |
| Chart Version | 1.4.0 |
| App Version | 1.0.0 |
| Helm Version | 3.4+ |
| Kubernetes Version | 1.19+ |

## 🏗️ Architecture

Mark consists of several microservices:

- **API Gateway** - Routes requests and handles authentication
- **Core API** - Main application logic and database operations
- **Web UI** - React-based frontend application
- **LTI Gateway** - Learning Tools Interoperability integration

## 📦 Components

### Core Services

| Component | Description | Default Image |
|-----------|-------------|---------------|
| `apiGateway` | API Gateway service | `ghcr.io/ibm-skills-network/mark/mark-api-gateway:latest` |
| `api` | Core API service | `ghcr.io/ibm-skills-network/mark/mark-api:latest` |
| `web` | Web UI service | `ghcr.io/ibm-skills-network/mark/mark-web:latest` |

### Dependencies

| Dependency | Version | Description |
|------------|---------|-------------|
| `lti-gateway` | 1.0.2 | LTI integration service |
| `sn-common` | 1.x.x | Common utilities and configurations |

## ⚙️ Configuration

### Basic Configuration

The following table lists the configurable parameters and their default values:

#### Global Configuration

| Parameter | Description | Default |
|-----------|-------------|---------|
| `global.imagePullSecrets` | Image pull secrets for private registries | `[{name: "icr-global"}]` |
| `nameOverride` | Override the name of the chart | `""` |
| `fullnameOverride` | Override the full name of the chart | `""` |

#### API Gateway Configuration

| Parameter | Description | Default |
|-----------|-------------|---------|
| `apiGateway.enabled` | Enable API Gateway deployment | `true` |
| `apiGateway.replicaCount` | Number of API Gateway replicas | `3` |
| `apiGateway.image.repository` | API Gateway image repository | `icr.io/skills-network/mark-api-gateway` |
| `apiGateway.image.pullPolicy` | Image pull policy | `IfNotPresent` |
| `apiGateway.containerPort` | Container port | `3000` |
| `apiGateway.service.type` | Service type | `ClusterIP` |
| `apiGateway.service.port` | Service port | `80` |
| `apiGateway.autoscaling.enabled` | Enable autoscaling | `false` |

#### Core API Configuration

| Parameter | Description | Default |
|-----------|-------------|---------|
| `api.enabled` | Enable Core API deployment | `true` |
| `api.replicaCount` | Number of Core API replicas | `3` |
| `api.image.repository` | Core API image repository | `icr.io/skills-network/mark-api` |
| `api.containerPort` | Container port | `3001` |
| `api.service.type` | Service type | `ClusterIP` |
| `api.service.port` | Service port | `80` |

#### Web UI Configuration

| Parameter | Description | Default |
|-----------|-------------|---------|
| `ui.enabled` | Enable Web UI deployment | `true` |
| `ui.replicaCount` | Number of Web UI replicas | `3` |
| `ui.image.repository` | Web UI image repository | `icr.io/skills-network/mark-ui` |
| `ui.containerPort` | Container port | `3000` |
| `ui.service.type` | Service type | `ClusterIP` |
| `ui.service.port` | Service port | `80` |

## 🔧 Common Configurations

### Production Deployment

For production deployments, consider using a custom values file:

```yaml
# production-values.yaml
global:
  imagePullSecrets:
    - name: my-registry-secret

apiGateway:
  replicaCount: 5
  resources:
    requests:
      memory: "256Mi"
      cpu: "100m"
    limits:
      memory: "512Mi"
      cpu: "500m"
  autoscaling:
    enabled: true
    minReplicas: 3
    maxReplicas: 10
    targetCPUUtilizationPercentage: 80

api:
  replicaCount: 5
  resources:
    requests:
      memory: "512Mi"
      cpu: "200m"
    limits:
      memory: "1Gi"
      cpu: "1000m"

ingress:
  enabled: true
  className: "nginx"
  annotations:
    cert-manager.io/cluster-issuer: "letsencrypt-prod"
  hosts:
    - host: mark.example.com
      paths:
        - path: /
          pathType: Prefix
  tls:
    - secretName: mark-tls
      hosts:
        - mark.example.com
```

Deploy with production configuration:

```bash
helm install mark-prod mark/mark -f production-values.yaml
```

### Development Deployment

For development with minimal resources:

```yaml
# dev-values.yaml
apiGateway:
  replicaCount: 1
  resources:
    requests:
      memory: "128Mi"
      cpu: "50m"

api:
  replicaCount: 1
  resources:
    requests:
      memory: "256Mi"
      cpu: "100m"

ui:
  replicaCount: 1
  resources:
    requests:
      memory: "128Mi"
      cpu: "50m"
```

### Custom Database Configuration

```yaml
# database-values.yaml
api:
  env:
    DATABASE_URL: "postgresql://user:password@postgres:5432/mark" # pragma: allowlist secret
  secretEnv:
    DATABASE_PASSWORD: "your-secure-password" # pragma: allowlist secret
```

## 🔍 Monitoring and Observability

### Health Checks

All services include configurable health checks:

```yaml
apiGateway:
  livenessProbe:
    initialDelaySeconds: 30
    timeoutSeconds: 5
    periodSeconds: 15
  readinessProbe:
    initialDelaySeconds: 10
    timeoutSeconds: 3
    periodSeconds: 10
```

### Service Mesh Integration

Mark is compatible with Istio service mesh:

```yaml
# istio-values.yaml
global:
  istio:
    enabled: true

apiGateway:
  podAnnotations:
    sidecar.istio.io/inject: "true"

api:
  podAnnotations:
    sidecar.istio.io/inject: "true"
```

## 📚 Examples

### Complete Example

See the [`examples/`](./examples/) directory for complete deployment examples:

- [`examples/minimal.yaml`](./examples/minimal.yaml) - Minimal development setup
- [`examples/production.yaml`](./examples/production.yaml) - Production-ready configuration
- [`examples/with-database.yaml`](./examples/with-database.yaml) - Deployment with external database

## 🛠️ Development

### Local Development

To work with the chart locally:

```bash
# Clone the repository
git clone https://github.com/ibm-skills-network/mark.git
cd mark/helm-chart

# Install dependencies
helm dependency update mark/

# Test the chart
helm lint mark/
helm template my-mark mark/ --debug

# Install locally
helm install my-mark mark/ --create-namespace --namespace mark
```

### Testing

```bash
# Lint the chart
helm lint mark/

# Test rendering
helm template test-release mark/ > rendered.yaml

# Validate against Kubernetes
helm template test-release mark/ | kubectl apply --dry-run=client -f -
```

## 📖 Documentation

- [Chart Values Reference](./mark/README.md) - Complete values documentation
- [Migration Guide](./docs/MIGRATION.md) - Upgrading between versions
- [Troubleshooting Guide](./docs/TROUBLESHOOTING.md) - Common issues and solutions
- [Security Guide](./docs/SECURITY.md) - Security best practices

## 🤝 Contributing

Contributions are welcome! Please see our [Contributing Guide](../CONTRIBUTING.md) for details.

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](../LICENSE) file for details.

## 📞 Support

- 🐛 [Report Issues](https://github.com/ibm-skills-network/mark/issues)
- 💬 [Discussions](https://github.com/ibm-skills-network/mark/discussions)
- 📧 Email: support@mark-platform.dev

## 🗺️ Roadmap

- [ ] Add support for horizontal pod autoscaling
- [ ] Integrate with Prometheus monitoring
- [ ] Add network policies
- [ ] Support for multiple ingress controllers
- [ ] Backup and restore procedures

---

**Note**: This documentation is for the official IBM Skills Network Mark platform repository.