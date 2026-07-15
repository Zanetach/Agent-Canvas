const RELEASE_OWNER = 'PooKiZhang';
const RELEASE_REPO = 'InUx_Canvas_Releases';
const RELEASE_API_URL = `https://api.github.com/repos/${RELEASE_OWNER}/${RELEASE_REPO}/releases/latest`;

function normalizeVersion(value) {
  const match = String(value || '').trim().match(/^v?(\d+)\.(\d+)\.(\d+)$/i);
  if (!match) return '';
  return match.slice(1).map(part => String(Number(part))).join('.');
}

function compareVersions(left, right) {
  const normalizedLeft = normalizeVersion(left);
  const normalizedRight = normalizeVersion(right);
  if (!normalizedLeft || !normalizedRight) {
    throw new Error('版本号格式必须是 x.y.z');
  }
  const leftParts = normalizedLeft.split('.').map(Number);
  const rightParts = normalizedRight.split('.').map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] > rightParts[index]) return 1;
    if (leftParts[index] < rightParts[index]) return -1;
  }
  return 0;
}

function isAllowedReleaseUrl(value) {
  try {
    const url = new URL(value);
    const expectedPrefix = `/${RELEASE_OWNER}/${RELEASE_REPO}/releases/`;
    return url.protocol === 'https:'
      && url.hostname === 'github.com'
      && url.pathname.startsWith(expectedPrefix);
  } catch {
    return false;
  }
}

async function checkLatestRelease({ currentVersion, fetchImpl = globalThis.fetch } = {}) {
  const normalizedCurrent = normalizeVersion(currentVersion);
  if (!normalizedCurrent) {
    return { status: 'error', currentVersion: String(currentVersion || ''), error: '当前版本号格式无效' };
  }
  if (typeof fetchImpl !== 'function') {
    return { status: 'error', currentVersion: normalizedCurrent, error: '当前环境无法检查更新' };
  }

  try {
    const response = await fetchImpl(RELEASE_API_URL, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': `InUx-Canvas/${normalizedCurrent}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    if (response.status === 404) {
      return {
        status: 'unavailable',
        currentVersion: normalizedCurrent,
        latestVersion: '',
        error: '公开发布仓库暂时没有可用版本',
      };
    }
    if (!response.ok) {
      throw new Error(`GitHub 返回 HTTP ${response.status}`);
    }

    const release = await response.json();
    const latestVersion = normalizeVersion(release?.tag_name);
    if (!latestVersion) throw new Error('最新发布版本号格式无效');
    const releaseUrl = String(release?.html_url || '');
    if (!isAllowedReleaseUrl(releaseUrl)) throw new Error('最新发布地址不可信');

    return {
      status: compareVersions(latestVersion, normalizedCurrent) > 0 ? 'available' : 'current',
      currentVersion: normalizedCurrent,
      latestVersion,
      releaseName: String(release?.name || `v${latestVersion}`),
      releaseNotes: String(release?.body || ''),
      publishedAt: String(release?.published_at || ''),
      releaseUrl,
    };
  } catch (error) {
    return {
      status: 'error',
      currentVersion: normalizedCurrent,
      latestVersion: '',
      error: error?.message || '检查更新失败',
    };
  }
}

module.exports = {
  RELEASE_API_URL,
  checkLatestRelease,
  compareVersions,
  isAllowedReleaseUrl,
  normalizeVersion,
};
