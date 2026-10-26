# Builds every service image in one BuildKit session so the shared stages
# (base pulls, repo copy, yarn cache mount) are done once instead of per image.
#   docker buildx bake                 # all five, tagged mark-<service>:dev
#   REGISTRY=ghcr.io/org/repo TAG=abc docker buildx bake --push api jobs

variable "REGISTRY" {
  default = "local"
}

variable "TAG" {
  default = "dev"
}

group "default" {
  targets = ["api-gateway", "api", "jobs", "web", "apiv3"]
}

target "_common" {
  context   = "."
  platforms = ["linux/amd64"]
}

target "api-gateway" {
  inherits   = ["_common"]
  dockerfile = "apps/api-gateway/Dockerfile"
  tags       = ["${REGISTRY}/mark-api-gateway:${TAG}"]
}

target "api" {
  inherits   = ["_common"]
  dockerfile = "apps/api/Dockerfile"
  tags       = ["${REGISTRY}/mark-api:${TAG}"]
}

target "jobs" {
  inherits   = ["_common"]
  dockerfile = "apps/jobs/Dockerfile"
  tags       = ["${REGISTRY}/mark-jobs:${TAG}"]
}

target "web" {
  inherits   = ["_common"]
  dockerfile = "apps/web/Dockerfile"
  tags       = ["${REGISTRY}/mark-web:${TAG}"]
}

target "apiv3" {
  inherits   = ["_common"]
  dockerfile = "apps/apiv3/Dockerfile"
  tags       = ["${REGISTRY}/mark-apiv3:${TAG}"]
}
