#!/usr/bin/env bash
# Deploy and rollback mechanics for the Yen API container.
#
# The GitHub Actions workflow .github/workflows/deploy.yml calls this script
# for every infrastructure step. Cloud authentication is OpenID Connect only:
# the runner exchanges a short-lived GitHub OIDC token for temporary cloud
# credentials, so no long-lived credentials live in GitHub Secrets.
#
# Subcommands:
#   image <git-sha>                build and push the API image, print its digest
#   migrate <env> <image-digest>   run database migrations as a one-off task
#   deploy <env> <image-digest>    register a task revision and roll containers
#   smoke <base-url> <git-sha>     post-deployment probes
#   rollback <env> [revision]      route traffic to an earlier task revision
#   selftest                       offline tests, including the migration
#                                  failure negative test
#
# Environment variables:
#   DRY_RUN=1                       print infrastructure commands instead of
#                                   running them
#   FAILPOINT=migrate               force the migration step to fail (selftest)
#   OIDC_ROLE_ARN                   cloud role assumed through OIDC
#   AWS_REGION                      cloud region
#   ECR_REPOSITORY                  ECR repository name for the API image
#   ECS_CLUSTER                     ECS cluster for the active environment
#   ECS_SERVICE                     ECS service for the active environment
#   ECS_CONTAINER_NAME              container name inside the task definition
#   ECS_MIGRATION_TASK_DEFINITION   task definition family for migration tasks
#   ECS_SUBNETS                     comma separated subnet ids
#   ECS_SECURITY_GROUPS             comma separated security group ids
#   MIGRATION_SECRET_ID             Secrets Manager id holding the migration
#                                   DATABASE_URL; read at deploy time only and
#                                   never stored in GitHub

set -euo pipefail

log() {
  printf '%s\n' "$*"
}

fail() {
  printf 'deploy-api: %s\n' "$*" >&2
  exit 1
}

usage() {
  sed -n '2,40p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

# Runs a command, or prints it when DRY_RUN is set. Value-producing
# infrastructure calls go through run_capture, which returns a fixed mock in
# dry run mode so a dry run still prints a complete, realistic plan.
run() {
  if [[ -n "${DRY_RUN:-}" ]]; then
    log "[dry-run] $*"
  else
    "$@"
  fi
}

run_capture() {
  if [[ -n "${DRY_RUN:-}" ]]; then
    log "[dry-run] $*"
    case "$1 $2" in
      "aws sts get-caller-identity")
        printf '%s\n' "${DRY_ACCOUNT_ID:-000000000000}"
        ;;
      "aws ecs describe-services")
        printf '%s\n' "${DRY_CURRENT_TASK_DEFINITION:-arn:aws:ecs:mock:000000000000:task-definition/yen-api:42}"
        ;;
      "aws ecs describe-task-definition")
        printf '%s\n' '{"containerDefinitions":[{"name":"api","image":"mock"}]}'
        ;;
      *)
        printf '%s\n' ""
        ;;
    esac
    return 0
  fi
  "$@"
}

require_vars() {
  local missing=()
  local name
  for name in "$@"; do
    [[ -n "${!name:-}" ]] || missing+=("$name")
  done
  if ((${#missing[@]} > 0)); then
    fail "missing required variables: ${missing[*]}"
  fi
}

# Exchanges the GitHub Actions OIDC token for temporary cloud credentials.
# Requires id-token: write on the calling workflow job; the token endpoint
# variables are provided by the runner.
assume_role() {
  local session=$1
  if [[ -n "${DRY_RUN:-}" ]]; then
    log "[dry-run] aws sts assume-role-with-web-identity --role-arn ${OIDC_ROLE_ARN:-unset} --role-session-name yen-api-$session"
    return 0
  fi
  require_vars OIDC_ROLE_ARN ACTIONS_ID_TOKEN_REQUEST_TOKEN ACTIONS_ID_TOKEN_REQUEST_URL
  local token
  token="$(curl --fail --silent --show-error \
    --header "Authorization: Bearer ${ACTIONS_ID_TOKEN_REQUEST_TOKEN}" \
    "${ACTIONS_ID_TOKEN_REQUEST_URL}&audience=sts.amazonaws.com" | jq -e -r '.value')" \
    || fail "could not fetch a GitHub OIDC token"
  local creds
  creds="$(aws sts assume-role-with-web-identity \
    --role-arn "$OIDC_ROLE_ARN" \
    --role-session-name "yen-api-$session" \
    --web-identity-token "$token" \
    --duration-seconds 900 \
    --query 'Credentials.[AccessKeyId,SecretAccessKey,SessionToken]' \
    --output text)" || fail "OIDC role assumption failed for $OIDC_ROLE_ARN"
  local key secret session_token
  read -r key secret session_token <<<"$creds"
  export AWS_ACCESS_KEY_ID="$key"
  export AWS_SECRET_ACCESS_KEY="$secret"
  export AWS_SESSION_TOKEN="$session_token"
}

# Builds the API image from the root Dockerfile and pushes it under an
# immutable tag. Prints the pushed digest so later jobs can pin the exact
# bytes they promote.
image() {
  local git_sha=${1:?usage: image <git-sha>}
  [[ "$git_sha" =~ ^[0-9a-f]{40}$ ]] || fail "git sha must be a full 40 character commit sha"
  [[ -f Dockerfile ]] || fail "no Dockerfile at the repository root"
  require_vars AWS_REGION ECR_REPOSITORY
  assume_role image

  local account_id registry_host registry_uri digest
  account_id="$(run_capture aws sts get-caller-identity --query 'Account' --output text)"
  registry_host="${account_id}.dkr.ecr.${AWS_REGION}.amazonaws.com"
  registry_uri="${registry_host}/${ECR_REPOSITORY}"

  if [[ -n "${DRY_RUN:-}" ]]; then
    log "[dry-run] aws ecr get-login-password | docker login --username AWS --password-stdin $registry_host"
    log "[dry-run] docker build --build-arg YEN_BUILD_SHA=$git_sha --tag $registry_uri:sha-$git_sha ."
    log "[dry-run] docker push $registry_uri:sha-$git_sha"
    log "digest=sha256:${DRY_IMAGE_DIGEST:-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa}"
    return 0
  fi

  aws ecr get-login-password | docker login --username AWS --password-stdin "$registry_host"
  docker build --build-arg YEN_BUILD_SHA="$git_sha" --tag "$registry_uri:sha-$git_sha" .
  docker push "$registry_uri:sha-$git_sha" >/dev/null
  digest="$(docker image inspect --format '{{join .RepoDigests ","}}' "$registry_uri:sha-$git_sha")"
  digest="${digest##*@}"
  [[ "$digest" =~ ^sha256:[0-9a-f]{64}$ ]] || fail "pushed image digest was not reported: $digest"
  if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
    echo "digest=$digest" >>"$GITHUB_OUTPUT"
  fi
  log "Pushed $registry_uri:sha-$git_sha as $digest"
}

# Builds the ECR image uri for a digest that the image job pushed in this run.
image_uri_for_digest() {
  local image_digest=$1
  local account_id
  account_id="$(run_capture aws sts get-caller-identity --query 'Account' --output text)"
  printf '%s\n' "${account_id}.dkr.ecr.${AWS_REGION}.amazonaws.com/${ECR_REPOSITORY}@${image_digest}"
}

# Registers a new task definition revision for the given family with the image
# pinned to a digest, so containers can never run bytes other than the ones
# the pipeline built and tested.
register_revision() {
  local family=$1
  local image_uri=$2
  local body
  body="$(run_capture aws ecs describe-task-definition --task-definition "$family" --query 'taskDefinition' --output json)"
  body="$(printf '%s' "$body" | jq \
    'del(.taskDefinitionArn, .revision, .status, .requiresAttributes, .compatibilities, .registeredAt, .registeredBy)
     | .containerDefinitions[0].image = $image' \
    --arg image "$image_uri")"
  run_capture aws ecs register-task-definition --cli-input-json "$body" --query 'taskDefinition.revision' --output text
}

# ECS run-task overrides cannot pin the image, so the migration task
# definition family is re-registered with the digest first, then run.
migrate() {
  local env_name=${1:?usage: migrate <env> <image-digest>}
  local image_digest=${2:?usage: migrate <env> <image-digest>}
  [[ "$image_digest" =~ ^sha256:[0-9a-f]{64}$ ]] \
    || fail "refusing to migrate without a content addressed image digest, got: $image_digest"
  if [[ "${FAILPOINT:-}" == "migrate" ]]; then
    fail "FAILPOINT=migrate: simulating a failed migration (selftest)"
  fi
  require_vars AWS_REGION ECR_REPOSITORY OIDC_ROLE_ARN ECS_CLUSTER \
    ECS_MIGRATION_TASK_DEFINITION ECS_CONTAINER_NAME ECS_SUBNETS ECS_SECURITY_GROUPS \
    MIGRATION_SECRET_ID
  assume_role "migrate-$env_name"

  local image_uri new_revision db_url task_arn exit_code
  image_uri="$(image_uri_for_digest "$image_digest")"
  new_revision="$(register_revision "$ECS_MIGRATION_TASK_DEFINITION" "$image_uri")"
  log "Migration task definition: $new_revision"
  db_url="$(run_capture aws secretsmanager get-secret-value --secret-id "$MIGRATION_SECRET_ID" --query 'SecretString' --output text)"
  task_arn="$(run_capture aws ecs run-task \
    --cluster "$ECS_CLUSTER" \
    --task-definition "$new_revision" \
    --launch-type FARGATE \
    --network-configuration "awsvpcConfiguration={subnets=[${ECS_SUBNETS}],securityGroups=[${ECS_SECURITY_GROUPS}],assignPublicIp=DISABLED}" \
    --overrides "$(jq -n \
      --arg container "$ECS_CONTAINER_NAME" \
      --arg db_url "$db_url" \
      '{containerOverrides: [{name: $container, command: ["node", "packages/db/dist/cli.js"],
        environment: [{name: "DATABASE_URL", value: $db_url}]}]}')" \
    --query 'tasks[0].taskArn' --output text)"
  log "Migration task started: $task_arn"
  if [[ -n "${DRY_RUN:-}" ]]; then
    return 0
  fi
  aws ecs wait tasks-stopped --cluster "$ECS_CLUSTER" --tasks "$task_arn"
  exit_code="$(aws ecs describe-tasks --cluster "$ECS_CLUSTER" --tasks "$task_arn" \
    --query 'tasks[0].containers[0].exitCode' --output text)"
  if [[ "$exit_code" != "0" ]]; then
    fail "migration task exited with code $exit_code; rollout halted before any container was replaced"
  fi
  log "Migrations applied for $env_name; traffic may now be routed to $image_digest"
}

# Rolls the ECS service onto a new task definition revision built from the
# pinned digest. The deployment circuit breaker rolls the service back
# automatically if tasks fail to become healthy, and the command fails if the
# service never stabilizes.
deploy() {
  local env_name=${1:?usage: deploy <env> <image-digest>}
  local image_digest=${2:?usage: deploy <env> <image-digest>}
  [[ "$image_digest" =~ ^sha256:[0-9a-f]{64}$ ]] \
    || fail "refusing to deploy without a content addressed image digest, got: $image_digest"
  require_vars AWS_REGION ECR_REPOSITORY OIDC_ROLE_ARN ECS_CLUSTER ECS_SERVICE
  assume_role "deploy-$env_name"

  local image_uri current family new_revision
  image_uri="$(image_uri_for_digest "$image_digest")"
  current="$(run_capture aws ecs describe-services \
    --cluster "$ECS_CLUSTER" --services "$ECS_SERVICE" \
    --query 'services[0].taskDefinition' --output text)"
  family="${current%:*}"
  new_revision="$(register_revision "$family" "$image_uri")"
  run aws ecs update-service \
    --cluster "$ECS_CLUSTER" \
    --service "$ECS_SERVICE" \
    --task-definition "$new_revision" \
    --deployment-configuration "deploymentCircuitBreaker={enable=true,rollback=true},maximumPercent=200,minimumHealthyPercent=100"
  if [[ -n "${DRY_RUN:-}" ]]; then
    return 0
  fi
  log "Waiting for $env_name to stabilize on $new_revision; the circuit breaker rolls back automatically if tasks fail"
  if ! aws ecs wait services-stable --cluster "$ECS_CLUSTER" --service "$ECS_SERVICE"; then
    fail "$env_name rollout did not stabilize; check the circuit breaker rollback and run: bash scripts/deploy-api.sh rollback $env_name"
  fi
  log "Deployed $image_digest to $env_name"
}

# Routes traffic back to an earlier task definition revision. With no explicit
# revision the command targets the previous revision. One command, no rebuild:
# it points the same service at an older, already registered revision.
rollback() {
  local env_name=${1:?usage: rollback <env> [revision]}
  local target_revision=${2:-}
  require_vars AWS_REGION OIDC_ROLE_ARN ECS_CLUSTER ECS_SERVICE
  assume_role "rollback-$env_name"

  local current family current_revision
  current="$(run_capture aws ecs describe-services \
    --cluster "$ECS_CLUSTER" --services "$ECS_SERVICE" \
    --query 'services[0].taskDefinition' --output text)"
  family="${current%:*}"
  current_revision="${current##*:}"
  if [[ -z "$target_revision" ]]; then
    target_revision=$((current_revision - 1))
  fi
  [[ "$target_revision" =~ ^[0-9]+$ ]] || fail "revision must be a number, got: $target_revision"
  [[ "$target_revision" -lt "$current_revision" ]] \
    || fail "target revision $target_revision must be older than the current revision $current_revision"
  log "Rolling $env_name back from revision $current_revision to $target_revision"
  run aws ecs update-service \
    --cluster "$ECS_CLUSTER" \
    --service "$ECS_SERVICE" \
    --task-definition "${family}:${target_revision}" \
    --deployment-configuration "deploymentCircuitBreaker={enable=true,rollback=true},maximumPercent=200,minimumHealthyPercent=100"
  if [[ -n "${DRY_RUN:-}" ]]; then
    return 0
  fi
  if ! aws ecs wait services-stable --cluster "$ECS_CLUSTER" --service "$ECS_SERVICE"; then
    fail "rollback to revision $target_revision did not stabilize"
  fi
  log "Rollback complete: $env_name serves $family:$target_revision"
}

main() {
  local cmd=${1:-}
  [[ -n "$cmd" ]] || { usage; exit 1; }
  shift
  case "$cmd" in
    image) image "$@" ;;
    migrate) migrate "$@" ;;
    deploy) deploy "$@" ;;
    smoke) smoke "$@" ;;
    rollback) rollback "$@" ;;
    selftest) selftest ;;
    -h | --help | help) usage ;;
    *)
      usage >&2
      fail "unknown subcommand: $cmd"
      ;;
  esac
}

main "$@"
