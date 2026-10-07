// Pool-water shader from handoff/water-background.html: fbm-warped caustics.
export const WATER_FRAGMENT = `
precision highp float;
uniform vec2 resolution;
uniform vec2 drift;
uniform float time;
uniform float scale;
uniform float sunlight;
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453123);}
vec2 hash2(vec2 p){return fract(sin(vec2(dot(p,vec2(127.1,311.7)),dot(p,vec2(269.5,183.3))))*43758.5453);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
float fbm(vec2 p){float r=0.,a=.5;for(int i=0;i<4;i++){r+=noise(p)*a;p=mat2(.8,-.6,.6,.8)*p*2.03+17.1;a*=.5;}return r;}
// Moving cellular boundaries approximate focused sunlight on the pool floor.
float caustic(vec2 p,float t){vec2 cell=floor(p),f=fract(p);float first=9.,second=9.;
for(int y=-1;y<=1;y++){for(int x=-1;x<=1;x++){vec2 g=vec2(float(x),float(y));vec2 rnd=hash2(cell+g);vec2 point=.5+.39*sin(6.2831*rnd+t*.32+vec2(.0,1.7));vec2 v=g+point-f;float d=dot(v,v);if(d<first){second=first;first=d;}else if(d<second){second=d;}}}
float edge=sqrt(second)-sqrt(first);return pow(1.-smoothstep(.015,.18,edge),2.4);}
void main(){
 vec2 uv=gl_FragCoord.xy/resolution;vec2 world=(gl_FragCoord.xy-.5*resolution)/min(resolution.x,resolution.y);
 world+=drift*.14;
 vec2 deep=world*5.2/scale;float t=time;
 vec2 warp=vec2(fbm(deep*.7+vec2(t*.10,-t*.07)),fbm(deep*.7+vec2(5.2-t*.06,t*.09)))-.5;
 vec2 p=deep+warp*1.8+vec2(t*.035,-t*.02);
 p+=vec2(sin(p.y*2.+t*.23),cos(p.x*1.7-t*.19))*.11;
 float c1=caustic(p,t);float c2=caustic(p*1.07+vec2(4.1,-3.7)+drift*.10,t+2.3);
 float focus=pow(c1*c2,.7);float light=c1*.32+c2*.18+focus*.95;
 float swell=fbm(world*2.2+vec2(t*.04,-t*.03));
 vec3 color=mix(vec3(.0,.17,.26),vec3(.01,.32,.40),swell*.8+.15);
 color+=vec3(.006,.04,.04)*sin(world.y*.8+world.x*.5+t*.07);
 color=mix(color,vec3(.16,.62,.66),clamp(light*sunlight,0.,.75));
 float haze=pow(max(0.,1.-length((uv-vec2(.22,.82))*vec2(.8,.7))),3.);
 color+=vec3(.02,.05,.05)*haze;
 float grain=hash(gl_FragCoord.xy+fract(time*.13)*91.7)-.5;color+=grain*.014;
 gl_FragColor=vec4(color,1.);
}
`;
