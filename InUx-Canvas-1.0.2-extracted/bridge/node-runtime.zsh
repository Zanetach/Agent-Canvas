beemax_node_score() {
  local node_bin="$1"
  local version major minor patch
  version="$($node_bin --version 2>/dev/null || true)"
  if [[ "$version" != v<->.* ]]; then
    return 1
  fi
  version="${version#v}"
  major="${version%%.*}"
  version="${version#*.}"
  minor="${version%%.*}"
  patch="${version#*.}"
  patch="${patch%%[^0-9]*}"
  (( major >= 20 )) || return 1
  print -r -- $(( major * 1000000 + minor * 1000 + ${patch:-0} ))
}

beemax_resolve_node() {
  if [[ -n "${BEEMAX_NODE:-}" ]]; then
    if [[ -x "$BEEMAX_NODE" ]] && beemax_node_score "$BEEMAX_NODE" >/dev/null; then
      print -r -- "$BEEMAX_NODE"
      return 0
    fi
    return 1
  fi

  local path_node
  path_node="$(command -v node 2>/dev/null || true)"
  if [[ -n "$path_node" && -x "$path_node" ]] && beemax_node_score "$path_node" >/dev/null; then
    print -r -- "$path_node"
    return 0
  fi

  local -a bundled_nodes
  local candidate score best_node="" best_score=0
  bundled_nodes=(
    "$HOME"/.cache/codex-runtimes/*/dependencies/node/bin/node(N)
  )
  for candidate in "${bundled_nodes[@]}"; do
    score="$(beemax_node_score "$candidate" || true)"
    if [[ -n "$score" ]] && (( score > best_score )); then
      best_node="$candidate"
      best_score="$score"
    fi
  done
  if [[ -n "$best_node" ]]; then
    print -r -- "$best_node"
    return 0
  fi

  return 1
}
