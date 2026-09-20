// Thin-volume part of Three's transmission shader, MIT; see THREE-LICENSE.txt.
// Native HDR viewport levels supply the original linear-light opaque buffer.
global uniform sampler2D market_transmission_0 : filter_linear, repeat_disable;
global uniform sampler2D market_transmission_1 : filter_linear, repeat_disable;
global uniform sampler2D market_transmission_2 : filter_linear, repeat_disable;
varying vec2 transmission_uv;
float tw0(float a) {return (a*(a*(-a+3.0)-3.0)+1.0)/6.0;}
float tw1(float a) {return (a*a*(3.0*a-6.0)+4.0)/6.0;}
float tw2(float a) {return (a*(a*(-3.0*a+3.0)+3.0)+1.0)/6.0;}
float tw3(float a) {return a*a*a/6.0;}
float tg0(float a) {return tw0(a)+tw1(a);}
float tg1(float a) {return tw2(a)+tw3(a);}
float th0(float a) {return -1.0+tw1(a)/tg0(a);}
float th1(float a) {return 1.0+tw3(a)/tg1(a);}
vec3 tbicubic(sampler2D tex, vec2 uv) {
 vec2 dimensions=vec2(textureSize(tex,0));
 uv=uv*dimensions+0.5;
 vec2 iuv=floor(uv),fuv=fract(uv);
 float g0x=tg0(fuv.x),g1x=tg1(fuv.x),h0x=th0(fuv.x),h1x=th1(fuv.x),h0y=th0(fuv.y),h1y=th1(fuv.y);
 vec2 p0=(vec2(iuv.x+h0x,iuv.y+h0y)-0.5)/dimensions;
 vec2 p1=(vec2(iuv.x+h1x,iuv.y+h0y)-0.5)/dimensions;
 vec2 p2=(vec2(iuv.x+h0x,iuv.y+h1y)-0.5)/dimensions;
 vec2 p3=(vec2(iuv.x+h1x,iuv.y+h1y)-0.5)/dimensions;
 return tg0(fuv.y)*(g0x*texture(tex,p0).rgb+g1x*texture(tex,p1).rgb)+tg1(fuv.y)*(g0x*texture(tex,p2).rgb+g1x*texture(tex,p3).rgb);
}
vec3 transmission_sample(vec2 uv,float roughness) {
 float lod=log2(float(textureSize(market_transmission_0,0).x))*roughness;
 vec3 middle=tbicubic(market_transmission_1,uv);
 if(lod<1.0)return mix(tbicubic(market_transmission_0,uv),middle,lod);
 return mix(middle,tbicubic(market_transmission_2,uv),clamp(lod-1.0,0.0,1.0));
}
