import { useEffect, useRef } from 'react'

const VERTEX_SHADER = `
  precision mediump float;
  attribute vec2 a_position;
  varying vec2 vUv;

  void main() {
    vUv = a_position;
    gl_Position = vec4(a_position, 0.0, 1.0);
  }
`

const FRAGMENT_SHADER = `
  precision mediump float;
  varying vec2 vUv;
  uniform vec2 u_resolution;
  uniform float u_scroll_progr;
  uniform float u_col_width;
  uniform float u_seed;
  uniform float u_scale;
  uniform float u_time;
  uniform float u_speed;
  uniform vec3 u_color;

  vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec3 permute(vec3 x) { return mod289(((x * 34.0) + 1.0) * x); }

  float snoise(vec2 v) {
    const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
    vec2 i = floor(v + dot(v, C.yy));
    vec2 x0 = v - i + dot(i, C.xx);
    vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
    vec4 x12 = x0.xyxy + C.xxzz;
    x12.xy -= i1;
    i = mod289(i);
    vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
    vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
    m = m * m;
    m = m * m;
    vec3 x = 2.0 * fract(p * C.www) - 1.0;
    vec3 h = abs(x) - 0.5;
    vec3 ox = floor(x + 0.5);
    vec3 a0 = x - ox;
    m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
    vec3 g;
    g.x = a0.x * x0.x + h.x * x0.y;
    g.yz = a0.yz * x12.xz + h.yz * x12.yw;
    return 130.0 * dot(m, g);
  }

  float get_l(vec2 v) {
    return 1.0 - clamp(0.0, 1.0, length(v));
  }

  float rand(float n) {
    return fract(sin(n) * 43758.5453123);
  }

  void main() {
    float scale = 0.001 * u_scale;
    float speed = 0.001 * u_speed;
    vec2 uv = vUv;
    uv.x *= scale * u_resolution.x;

    vec2 noise_uv = uv * 5.0;
    noise_uv.y *= 0.25 * scale * u_resolution.y;
    noise_uv += vec2(0.0, u_time * 1.5 * speed);
    float shape = clamp(0.5 + 0.5 * snoise(noise_uv), 0.0, 1.0);
    shape *= pow(0.5 * uv.y + 0.7 + pow(u_scroll_progr, 2.0) + (0.4 * u_scroll_progr * (1.0 - pow(vUv.x - 0.2, 2.0))), 10.0);
    shape = clamp(shape, 0.0, 1.0);

    float dots = 0.0;
    float bars = 0.0;
    float light = 0.0;
    const int num_col = 9;
    for (int i = 0; i < num_col; i++) {
      vec2 col_uv = vUv;
      float start_time_offset = rand(100.0 * (float(i) + u_seed));
      float c_t = fract(u_time * speed + start_time_offset);
      float drop_time = 0.2 + 0.6 * rand(10.0 * (float(i) + u_seed));
      float before_drop_normal = c_t / drop_time;
      float before_drop_t = pow(before_drop_normal, 0.4) * drop_time;
      float after_drop_normal = max(0.0, c_t - drop_time) / (1.0 - drop_time);
      float after_drop_t_dot = 3.0 * pow(after_drop_normal, 2.0) * (1.0 - drop_time);
      float after_drop_t_bar = pow(after_drop_normal, 2.0) * drop_time;
      float eased_drop_t = step(c_t, drop_time) * before_drop_t;
      eased_drop_t += step(drop_time, c_t) * (drop_time + after_drop_t_dot);
      col_uv.y += (1.0 + 3.0 * rand(15.0 * float(i))) * u_scroll_progr;
      col_uv.x *= u_resolution.x / u_resolution.y;
      col_uv *= 7.0 * scale * u_resolution.y;
      col_uv.x += u_col_width * (0.5 * float(num_col) - float(i));

      vec2 dot_uv = col_uv;
      dot_uv.y += 4.0 * (eased_drop_t - 0.5);
      float dot = pow(get_l(dot_uv), 4.0);
      float drop_grow = step(c_t, drop_time) * pow(before_drop_normal, 0.4);
      drop_grow += step(drop_time, c_t) * mix(1.0, 0.8, clamp(7.0 * after_drop_normal, 0.0, 1.0));
      dot *= drop_grow * step(0.5, drop_time);
      dots += dot;

      vec2 bar_uv = col_uv;
      bar_uv.y += step(c_t, drop_time) * 4.0 * (before_drop_t - 0.5);
      bar_uv.y += step(drop_time, c_t) * 4.0 * (drop_time - after_drop_t_bar - 0.5);
      float bar = smoothstep(-0.5, 0.0, bar_uv.x) * (1.0 - smoothstep(0.0, 0.5, bar_uv.x));
      bar = pow(bar, 4.0);
      light += bar * smoothstep(0.0, 0.1, -bar_uv.x);
      bar *= smoothstep(-0.2, 0.2, bar_uv.y);
      bars += bar;
    }

    shape = clamp(shape + bars, 0.0, 1.0) + dots;
    float gooey = smoothstep(0.48, 0.5, shape) - 0.1 * smoothstep(0.5, 0.6, shape);
    vec3 color = u_color;
    color.r += 0.2 * (1.0 - vUv.y) * (1.0 - u_scroll_progr);
    color *= gooey;
    color = mix(color, vec3(1.0), max(0.0, 1.0 - 2.0 * vUv.y) * light * smoothstep(0.1, 0.7, snoise(0.5 * uv)) * (smoothstep(0.49, 0.6, shape) - smoothstep(0.6, 1.0, shape)));
    gl_FragColor = vec4(color, gooey);
  }
`

const DOTS = Array.from({ length: 13 * 13 }, (_, index) => {
  const row = Math.floor(index / 13)
  const column = index % 13
  const distanceFromCenter = Math.hypot(row - 6, column - 6)
  return { index, delay: `${Math.round(distanceFromCenter * 32)}ms` }
})

function compileShader(gl, type, source) {
  const shader = gl.createShader(type)
  if (!shader) throw new Error('Unable to allocate a WebGL shader.')
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) || 'Unknown shader compilation error.'
    gl.deleteShader(shader)
    throw new Error(message)
  }
  return shader
}

export default function GooeyScrollBanner() {
  const containerRef = useRef(null)
  const canvasRef = useRef(null)

  useEffect(() => {
    const container = containerRef.current
    const canvas = canvasRef.current
    if (!container || !canvas) return undefined

    const gl = canvas.getContext('webgl', { alpha: true, antialias: false, powerPreference: 'low-power' })
    if (!gl) {
      console.warn('WebGL is unavailable; the gooey banner is using its CSS background.')
      return undefined
    }

    let program
    let frameId = 0
    let visible = true
    let scrollProgress = 0
    let lastProgress = -1
    const bannerStartY = window.scrollY + container.getBoundingClientRect().top
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')

    try {
      const vertexShader = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER)
      const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER)
      program = gl.createProgram()
      if (!program) throw new Error('Unable to allocate a WebGL program.')
      gl.attachShader(program, vertexShader)
      gl.attachShader(program, fragmentShader)
      gl.linkProgram(program)
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        throw new Error(gl.getProgramInfoLog(program) || 'Unable to link the gooey banner shader.')
      }

      gl.deleteShader(vertexShader)
      gl.deleteShader(fragmentShader)
      gl.useProgram(program)
      const positions = gl.createBuffer()
      if (!positions) throw new Error('Unable to allocate the WebGL canvas buffer.')
      gl.bindBuffer(gl.ARRAY_BUFFER, positions)
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
      const positionLocation = gl.getAttribLocation(program, 'a_position')
      gl.enableVertexAttribArray(positionLocation)
      gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0)

      const uniforms = {
        resolution: gl.getUniformLocation(program, 'u_resolution'),
        progress: gl.getUniformLocation(program, 'u_scroll_progr'),
        colWidth: gl.getUniformLocation(program, 'u_col_width'),
        seed: gl.getUniformLocation(program, 'u_seed'),
        scale: gl.getUniformLocation(program, 'u_scale'),
        time: gl.getUniformLocation(program, 'u_time'),
        speed: gl.getUniformLocation(program, 'u_speed'),
        color: gl.getUniformLocation(program, 'u_color'),
      }
      if (Object.values(uniforms).some((uniform) => uniform === null)) {
        throw new Error('A required gooey banner shader uniform was not found.')
      }

      gl.uniform1f(uniforms.colWidth, 0.7)
      gl.uniform1f(uniforms.seed, 0.231)
      gl.uniform1f(uniforms.scale, 0.25)
      gl.uniform1f(uniforms.speed, reducedMotion.matches ? 0 : 0.2)
      gl.uniform3f(uniforms.color, 0.92, 0.24, 0.39)
      gl.clearColor(0, 0, 0, 0)

      const resize = () => {
        const { width, height } = container.getBoundingClientRect()
        if (!width || !height) return
        const pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5, Math.sqrt(1400000 / (width * height)))
        canvas.width = Math.max(1, Math.round(width * pixelRatio))
        canvas.height = Math.max(1, Math.round(height * pixelRatio))
        gl.viewport(0, 0, canvas.width, canvas.height)
        gl.uniform2f(uniforms.resolution, canvas.width, canvas.height)
      }
      const updateProgress = () => {
        const bounds = container.getBoundingClientRect()
        scrollProgress = Math.max(0, Math.min(1, (window.scrollY - bannerStartY) / (window.innerHeight + bounds.height)))
      }
      const render = (time) => {
        if (!visible) return
        if (!reducedMotion.matches) gl.uniform1f(uniforms.time, time)
        if (lastProgress !== scrollProgress) {
          gl.uniform1f(uniforms.progress, reducedMotion.matches ? 0.15 : scrollProgress)
          lastProgress = scrollProgress
        }
        gl.clear(gl.COLOR_BUFFER_BIT)
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
        if (!reducedMotion.matches) frameId = window.requestAnimationFrame(render)
      }
      const onScroll = () => updateProgress()
      const onVisibilityChange = () => {
        visible = document.visibilityState === 'visible'
        if (visible && !reducedMotion.matches) frameId = window.requestAnimationFrame(render)
        else window.cancelAnimationFrame(frameId)
      }

      const resizeObserver = new ResizeObserver(resize)
      resizeObserver.observe(container)
      window.addEventListener('scroll', onScroll, { passive: true })
      window.addEventListener('resize', resize)
      document.addEventListener('visibilitychange', onVisibilityChange)
      updateProgress()
      resize()
      render(performance.now())

      return () => {
        resizeObserver.disconnect()
        window.removeEventListener('scroll', onScroll)
        window.removeEventListener('resize', resize)
        document.removeEventListener('visibilitychange', onVisibilityChange)
        window.cancelAnimationFrame(frameId)
        gl.deleteProgram(program)
      }
    } catch (error) {
      if (program) gl.deleteProgram(program)
      console.error('The gooey banner could not initialize its WebGL shader.', error)
      return undefined
    }
  }, [])

  return <section className="gooey-banner" ref={containerRef} aria-label="Rere Cloud welcome">
    <canvas className="gooey-banner-canvas" ref={canvasRef} aria-hidden="true" />
    <div className="gooey-visual" aria-hidden="true">
      <div className="gooey-blob-field">
        <span className="gooey-blob gooey-blob-pink" />
        <span className="gooey-blob gooey-blob-violet" />
        <span className="gooey-blob gooey-blob-cyan" />
        <span className="gooey-blob gooey-blob-coral" />
      </div>
      <div className="gooey-dot-grid">
        {DOTS.map(({ index, delay }) => <i key={index} style={{ animationDelay: delay }} />)}
      </div>
    </div>
    <div className="gooey-banner-copy">
      <p className="eyebrow">YOUR SPACE, IN MOTION</p>
      <h2>Everything you care about,<br />flowing together.</h2>
      <span className="gooey-banner-hint"><i aria-hidden="true">↓</i> Scroll to explore your cloud</span>
    </div>
  </section>
}
