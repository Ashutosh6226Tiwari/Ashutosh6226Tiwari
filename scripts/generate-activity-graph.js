const fs = require('fs');
const https = require('https');
const path = require('path');

const token = process.env.GITHUB_TOKEN;
const username = process.env.USERNAME || process.env.GITHUB_REPOSITORY?.split('/')[0];

if (!token || !username) {
  console.error("Missing GITHUB_TOKEN or USERNAME");
  process.exit(1);
}

const query = `
  query($userName:String!) {
    user(login: $userName){
      contributionsCollection {
        contributionCalendar {
          totalContributions
          weeks {
            contributionDays {
              contributionCount
              date
            }
          }
        }
      }
    }
  }
`;

const data = JSON.stringify({
  query,
  variables: { userName: username },
});

const options = {
  hostname: 'api.github.com',
  port: 443,
  path: '/graphql',
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(data),
    'User-Agent': 'Node.js',
  },
};

const req = https.request(options, (res) => {
  let body = '';
  res.on('data', (chunk) => body += chunk);
  res.on('end', () => {
    const result = JSON.parse(body);
    if (result.errors) {
      console.error(result.errors);
      process.exit(1);
    }
    generateSvg(result.data.user.contributionsCollection.contributionCalendar);
  });
});

req.on('error', (e) => {
  console.error(e);
  process.exit(1);
});

req.write(data);
req.end();

function generateSvg(calendar) {
  const weeks = calendar.weeks;
  
  // Aggregate contributions by week (53 data points)
  const dataPoints = weeks.map(week => {
    return week.contributionDays.reduce((sum, day) => sum + day.contributionCount, 0);
  });

  const width = 800;
  const height = 300;
  const paddingX = 60;
  const paddingY = 50;
  
  const innerWidth = width - paddingX * 2;
  const innerHeight = height - paddingY * 2;
  
  const maxContributions = Math.max(...dataPoints, 1);
  
  // Create path points
  const stepX = innerWidth / (dataPoints.length - 1);
  
  const points = dataPoints.map((val, i) => {
    const x = paddingX + i * stepX;
    // Y scales from paddingY (top) to height-paddingY (bottom)
    const y = (height - paddingY) - (val / maxContributions) * innerHeight;
    return { x, y };
  });

  // Calculate Bezier curves for smooth line
  let lineD = `M ${points[0].x},${points[0].y} `;
  let pathD = `M ${points[0].x},${height - paddingY} L ${points[0].x},${points[0].y} `;
  
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    const cx = (prev.x + curr.x) / 2;
    const curve = `C ${cx},${prev.y} ${cx},${curr.y} ${curr.x},${curr.y} `;
    lineD += curve;
    pathD += curve;
  }
  
  pathD += `L ${points[points.length - 1].x},${height - paddingY} Z`;

  const svg = `
<svg width="100%" height="100%" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="grad" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#a855f7" stop-opacity="0.4" />
      <stop offset="100%" stop-color="#a855f7" stop-opacity="0.0" />
    </linearGradient>
  </defs>
  
  <!-- Background -->
  <rect width="100%" height="100%" fill="#09090b" rx="10" />
  
  <!-- Grid -->
  <line x1="${paddingX}" y1="${paddingY}" x2="${width - paddingX}" y2="${paddingY}" stroke="#27272a" stroke-width="1" />
  <line x1="${paddingX}" y1="${height / 2}" x2="${width - paddingX}" y2="${height / 2}" stroke="#27272a" stroke-width="1" stroke-dasharray="5,5" />
  <line x1="${paddingX}" y1="${height - paddingY}" x2="${width - paddingX}" y2="${height - paddingY}" stroke="#27272a" stroke-width="1" />
  
  <!-- Filled Area -->
  <path d="${pathD}" fill="url(#grad)" />
  
  <!-- Line -->
  <path d="${lineD}" fill="none" stroke="#a855f7" stroke-width="3" />
  
  <!-- Data Points (dots) -->
  ${points.map(p => `<circle cx="${p.x}" cy="${p.y}" r="3" fill="#ffffff" />`).join('\\n  ')}
  
  <!-- Labels -->
  <text x="${width / 2}" y="30" fill="#a1a1aa" font-family="sans-serif" font-size="16" font-weight="bold" text-anchor="middle">
    Activity Overview (${calendar.totalContributions} total contributions in the last year)
  </text>
  <text x="${paddingX - 10}" y="${paddingY + 5}" fill="#a1a1aa" font-family="sans-serif" font-size="12" text-anchor="end">${maxContributions}</text>
  <text x="${paddingX - 10}" y="${height / 2 + 5}" fill="#a1a1aa" font-family="sans-serif" font-size="12" text-anchor="end">${Math.round(maxContributions / 2)}</text>
  <text x="${paddingX - 10}" y="${height - paddingY + 5}" fill="#a1a1aa" font-family="sans-serif" font-size="12" text-anchor="end">0</text>
</svg>
`;

  const outDir = path.join(__dirname, '../profile-summary-card-output/radical');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, '2-activity-graph.svg'), svg.trim());
  console.log("Activity graph generated successfully at", path.join(outDir, '2-activity-graph.svg'));
}
