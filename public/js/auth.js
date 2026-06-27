// 水墨粒子背景动画
class InkParticle {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.reset();
  }

  reset() {
    this.x = Math.random() * this.canvas.width;
    this.y = Math.random() * this.canvas.height;
    this.size = Math.random() * 3 + 1;
    this.speedX = (Math.random() - 0.5) * 0.3;
    this.speedY = (Math.random() - 0.5) * 0.3;
    this.opacity = Math.random() * 0.15 + 0.05;
    this.life = 0;
    this.maxLife = Math.random() * 300 + 200;
  }

  update() {
    this.x += this.speedX;
    this.y += this.speedY;
    this.life++;

    if (this.life > this.maxLife || 
        this.x < 0 || this.x > this.canvas.width ||
        this.y < 0 || this.y > this.canvas.height) {
      this.reset();
    }
  }

  draw() {
    this.ctx.beginPath();
    this.ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
    this.ctx.fillStyle = `rgba(40, 30, 20, ${this.opacity * (1 - this.life / this.maxLife)})`;
    this.ctx.fill();
  }
}

// 初始化水墨背景
function initInkBackground() {
  const canvas = document.getElementById('inkCanvas');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');

  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }
  resize();
  window.addEventListener('resize', resize);

  const particles = Array.from({ length: 60 }, () => new InkParticle(canvas));

  function animate() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    particles.forEach(p => {
      p.update();
      p.draw();
    });
    requestAnimationFrame(animate);
  }
  animate();
}

// 检查是否已登录
checkAuth();

// 标签切换
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.auth-form').forEach(f => f.classList.remove('active'));

    btn.classList.add('active');
    const tab = btn.dataset.tab;
    document.getElementById(tab === 'login' ? 'loginForm' : 'registerForm').classList.add('active');

    // 清除错误信息
    document.getElementById('loginError').textContent = '';
    document.getElementById('regError').textContent = '';
  });
});

// 登录表单
document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = document.getElementById('loginUsername').value.trim();
  const password = document.getElementById('loginPassword').value;
  const errorEl = document.getElementById('loginError');

  if (!username || !password) {
    errorEl.textContent = '请填写完整信息';
    return;
  }

  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });

    const data = await res.json();
    if (data.success) {
      localStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify(data.user));
      window.location.replace('/lobby');
    } else {
      errorEl.textContent = data.error || '登录失败';
    }
  } catch (err) {
    errorEl.textContent = '网络错误，请重试';
  }
});

// 注册表单
document.getElementById('registerForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = document.getElementById('regUsername').value.trim();
  const nickname = document.getElementById('regNickname').value.trim();
  const password = document.getElementById('regPassword').value;
  const errorEl = document.getElementById('regError');

  if (!username || !password) {
    errorEl.textContent = '请填写完整信息';
    return;
  }

  if (username.length < 2 || username.length > 16) {
    errorEl.textContent = '用户名长度应为2-16位';
    return;
  }

  if (password.length < 6) {
    errorEl.textContent = '密码至少6位';
    return;
  }

  try {
    const res = await fetch('/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, nickname })
    });

    const data = await res.json();
    if (data.success) {
      localStorage.setItem('token', data.token);
      window.location.replace('/lobby');
    } else {
      errorEl.textContent = data.error || '注册失败';
    }
  } catch (err) {
    errorEl.textContent = '网络错误，请重试';
  }
});

// 认证检查
async function checkAuth() {
  const token = localStorage.getItem('token');
  if (!token) return;

  try {
    const res = await fetch('/api/me', {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    const data = await res.json();
    if (res.ok && data.success && data.user && data.user.username) {
      // 已登录且用户信息有效，跳转到主页
      localStorage.setItem('user', JSON.stringify(data.user));
      if (window.location.pathname === '/login' || window.location.pathname === '/') {
        window.location.replace('/lobby');
      }
    } else {
      // Token无效或用户不存在
      localStorage.removeItem('token');
      localStorage.removeItem('user');
    }
  } catch (err) {
    console.error('认证检查失败', err);
    localStorage.removeItem('token');
    localStorage.removeItem('user');
  }
}

// 修复 iOS 输入框焦点切换时键盘遮挡问题
(function fixIOSInputFocus() {
  function scrollInputIntoView() {
    const el = document.activeElement;
    if (el && el.tagName === 'INPUT' && el.closest('.auth-form')) {
      setTimeout(() => el.scrollIntoView({ block: 'center', behavior: 'smooth' }), 100);
    }
  }

  // 方案1：visualViewport 变化（键盘弹出/收起）时滚动
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', scrollInputIntoView);
  }

  // 方案2：焦点进入输入框时滚动
  document.addEventListener('focusin', function (e) {
    const input = e.target;
    if (!input || input.tagName !== 'INPUT') return;
    if (!input.closest('.auth-form')) return;
    setTimeout(() => input.scrollIntoView({ block: 'center', behavior: 'smooth' }), 350);
  });
})();

// 初始化
document.addEventListener('DOMContentLoaded', () => {
  initInkBackground();
});
