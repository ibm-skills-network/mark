# Helm Chart Versioning Strategy

This document outlines the versioning strategy for Mark Helm charts to ensure consistency and predictability for users.

## Versioning Scheme

We follow [Semantic Versioning (SemVer)](https://semver.org/) for chart versions:

```
MAJOR.MINOR.PATCH
```

- **MAJOR**: Backwards incompatible changes
- **MINOR**: New features, backwards compatible
- **PATCH**: Bug fixes, backwards compatible

## Version Components

### Chart Version vs App Version

- **Chart Version** (`version` in Chart.yaml): Version of the Helm chart itself
- **App Version** (`appVersion` in Chart.yaml): Version of the Mark application

These versions are independent and follow different release cycles.

## Release Process

### 1. Chart Version Bumping

| Change Type | Version Bump | Example |
|-------------|--------------|---------|
| Breaking changes to chart templates or values | MAJOR | 1.4.0 → 2.0.0 |
| New optional features, new values | MINOR | 1.4.0 → 1.5.0 |
| Bug fixes, security patches | PATCH | 1.4.0 → 1.4.1 |

### 2. Breaking Changes (MAJOR)

Examples of breaking changes:
- Removing or renaming values
- Changing default values that affect behavior
- Modifying resource names or labels
- Updating required Kubernetes version
- Removing support for older API versions

### 3. New Features (MINOR)

Examples of minor changes:
- Adding new optional configuration values
- Adding new optional components
- Improving documentation
- Adding new templates (backwards compatible)

### 4. Bug Fixes (PATCH)

Examples of patch changes:
- Fixing template errors
- Correcting documentation
- Security updates that don't change functionality
- Resource limit adjustments

## Automated Versioning

### GitHub Actions Integration

The chart version is automatically managed through GitHub Actions:

```yaml
# .github/workflows/chart-version.yml
name: Chart Version Management

on:
  push:
    branches: [master]
    paths: ['helm-chart/**']

jobs:
  version-bump:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Bump chart version
        run: |
          # Automated version bumping logic
          # Based on commit messages or change types
```

### Commit Message Convention

Use conventional commit messages to trigger appropriate version bumps:

```bash
# PATCH version bump
git commit -m "fix(helm): correct ingress template syntax"

# MINOR version bump
git commit -m "feat(helm): add support for pod disruption budgets"

# MAJOR version bump
git commit -m "feat(helm)!: remove deprecated values.legacy section"
```

## Version History

### Current Version: 1.4.0

| Version | Release Date | Type | Changes |
|---------|--------------|------|---------|
| 1.4.0 | 2024-01-15 | Minor | Added autoscaling support, improved documentation |
| 1.3.2 | 2024-01-10 | Patch | Fixed ingress template bug |
| 1.3.1 | 2024-01-05 | Patch | Security updates |
| 1.3.0 | 2024-01-01 | Minor | Added monitoring support |

## Upgrade Guidelines

### Upgrading Between Versions

#### Patch Upgrades (e.g., 1.4.0 → 1.4.1)
- Safe to upgrade without changes
- No configuration changes required
- Rolling update recommended

```bash
helm upgrade my-mark mark/mark
```

#### Minor Upgrades (e.g., 1.4.0 → 1.5.0)
- Review new features and options
- Update values.yaml if desired
- Check release notes for new features

```bash
# Review what changed
helm diff upgrade my-mark mark/mark

# Upgrade
helm upgrade my-mark mark/mark
```

#### Major Upgrades (e.g., 1.4.0 → 2.0.0)
- **Review breaking changes carefully**
- Test in non-production environment first
- Update values.yaml for breaking changes
- Consider backup before upgrade

```bash
# Backup current configuration
helm get values my-mark > backup-values.yaml

# Review breaking changes
cat CHANGELOG.md

# Test upgrade
helm upgrade my-mark mark/mark --dry-run

# Perform upgrade
helm upgrade my-mark mark/mark
```

## Deprecation Policy

### Deprecation Timeline

1. **Announcement**: Feature marked as deprecated in documentation
2. **Warning Phase**: Warning messages in chart templates (1 minor version)
3. **Removal**: Feature removed in next major version

### Example Deprecation

```yaml
# In values.yaml - deprecated feature
legacy:
  enabled: false  # DEPRECATED: Use newFeature instead. Will be removed in v2.0.0

# In template - warning
{{- if .Values.legacy.enabled }}
  {{- fail "ERROR: legacy.enabled is deprecated. Use newFeature.enabled instead. Will be removed in v2.0.0" }}
{{- end }}
```

## Release Channels

### Stable Channel
- Production-ready releases
- Full testing and validation
- Recommended for production use

### Beta Channel
- Pre-release versions
- Feature complete but may have bugs
- Suitable for testing environments

### Alpha Channel
- Development versions
- May have incomplete features
- For development and early testing only

## Version Dependencies

### Kubernetes Version Support

| Chart Version | Kubernetes Version | Notes |
|---------------|-------------------|-------|
| 1.4.x | 1.19+ | Current stable |
| 1.3.x | 1.18+ | Previous stable |
| 1.2.x | 1.17+ | Legacy support |

### Helm Version Support

| Chart Version | Helm Version | Notes |
|---------------|--------------|-------|
| 1.4.x | 3.4+ | Current requirement |
| 1.3.x | 3.2+ | Previous requirement |

## Best Practices

### For Chart Developers

1. **Always test upgrades** from previous versions
2. **Document breaking changes** clearly
3. **Use semantic commit messages** for automated versioning
4. **Update CHANGELOG.md** with each release
5. **Test with multiple Kubernetes versions**

### For Chart Users

1. **Pin chart versions** in production
2. **Test upgrades** in staging environment first
3. **Read release notes** before upgrading
4. **Backup configuration** before major upgrades
5. **Monitor application** after upgrades

## Release Checklist

- [ ] Update Chart.yaml version
- [ ] Update CHANGELOG.md
- [ ] Test chart installation
- [ ] Test chart upgrade from previous version
- [ ] Validate against multiple Kubernetes versions
- [ ] Update documentation if needed
- [ ] Create GitHub release
- [ ] Notify users of breaking changes (if major version)

## Tools and Automation

### Chart Testing

```bash
# Lint chart
helm lint helm-chart/mark/

# Test installation
helm install test-release helm-chart/mark/ --dry-run

# Test upgrade
helm upgrade test-release helm-chart/mark/ --dry-run
```

### Version Management Tools

- **chart-releaser**: Automated GitHub releases
- **semantic-release**: Automated versioning based on commits
- **helm-docs**: Automated documentation generation

This versioning strategy ensures predictable, reliable releases while maintaining backwards compatibility and clear upgrade paths for users.