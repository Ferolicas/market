// Lighting/BRDF/cube-UV adapted from three.js (MIT).
// Copyright 2010-2026 three.js authors; see assets/lighting/THREE-LICENSE.txt.
shader_type spatial;
render_mode ambient_light_disabled;
uniform vec4 base_color : source_color = vec4(1.0);
uniform sampler2D color_map : source_color, hint_default_white;
uniform sampler2D dfg_lut : filter_linear, repeat_disable;
uniform sampler2D environment_map : filter_linear, repeat_disable;
uniform float alpha_threshold = 0.5;
uniform float transmission_amount = 0.0;
varying flat float linear_pass;
// TRANSMISSION_DECLARATIONS
uniform float rough = 1.0;
uniform float metal = 0.0;
uniform float coat = 0.0;
uniform float coat_rough = 0.0;
uniform float specular_intensity = 1.0;
uniform vec3 sheen_color : source_color = vec3(1.0);
uniform float sheen = 0.0;
uniform float sheen_rough = 1.0;
varying float geometry_roughness;
varying vec3 coat_normal;
varying vec3 material_sheen;
uniform bool vertex_color = false;
uniform bool unlit = false;
uniform vec3 glow : source_color = vec3(0.0);
global uniform float market_ambient;
global uniform vec4 market_fog;
global uniform int market_light_count;
global uniform sampler2D market_light_data : filter_nearest, repeat_disable;
uniform bool receive_shadows = true;
uniform bool mapped_tone = true;
uniform bool use_fog = true;
uniform float environment_intensity = 0.28;
uniform float environment_max_mip = 6.0;
uniform vec2 environment_texel = vec2(0.002976190476,0.00390625);
uniform bool studio = false;
uniform float studio_ambient = 1.45;
uniform sampler2D roughness_map : hint_default_white;
uniform sampler2D metallic_map : hint_default_white;
uniform vec4 roughness_channel = vec4(0.0,1.0,0.0,0.0);
uniform vec4 metallic_channel = vec4(0.0,0.0,1.0,0.0);
uniform sampler2D normal_map : hint_normal;
uniform bool has_normal = false;
uniform float normal_strength = 1.0;
uniform sampler2D emission_map : source_color, hint_default_black;
uniform bool emission_multiply = false;
uniform bool emission_has_map = false;
uniform float emission_energy = 1.0;
uniform sampler2D occlusion_map : hint_default_white;
uniform vec4 occlusion_channel = vec4(1.0,0.0,0.0,0.0);
uniform bool occlusion_uv2 = false;
uniform vec3 uv_scale = vec3(1.0);
uniform vec3 uv_offset = vec3(0.0);
varying vec3 material_glow;
varying float material_ao;
varying float fog_depth;
varying vec3 world_position;
varying vec3 material_base;
void vertex() { linear_pass = CAMERA_VISIBLE_LAYERS == 2u ? 1.0 : 0.0; world_position = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz; fog_depth = -(MODELVIEW_MATRIX * vec4(VERTEX,1.0)).z; }
vec3 to_linear(vec3 c) { return mix(pow((c+0.055)/1.055,vec3(2.4)),c/12.92,lessThan(c,vec3(0.04045))); }
vec3 to_srgb(vec3 c) { return mix(1.055*pow(max(c,vec3(0.0)),vec3(1.0/2.4))-0.055,c*12.92,lessThan(c,vec3(0.0031308))); }
// Invert 4.7.2 Compatibility's cubic input conversion and power-only output
// conversion. Their approximations otherwise crush Three's dark sRGB colours.
vec3 compatibility_input(vec3 linear_color) {
 vec3 value=to_srgb(linear_color);
 for(int i=0;i<4;i++) {
  vec3 polynomial=value*(value*(value*0.305306011+0.682171111)+0.012522878);
  vec3 derivative=value*(value*0.915918033+1.364342222)+0.012522878;
  value=max(vec3(0.0),value-(polynomial-linear_color)/derivative);
 }
 return value;
}
vec3 compatibility_output(vec3 encoded_color) { return pow((max(encoded_color,vec3(0.0))+0.055)/1.055,vec3(2.4)); }
vec3 aces(vec3 color) {
 mat3 input_matrix = mat3(vec3(0.59719,0.07600,0.02840),vec3(0.35458,0.90834,0.13383),vec3(0.04823,0.01566,0.83777));
 mat3 output_matrix = mat3(vec3(1.60475,-0.10208,-0.00327),vec3(-0.53108,1.10813,-0.07276),vec3(-0.07367,-0.00605,1.07602));
 color = input_matrix * (color / 0.6);
 color = (color * (color + 0.0245786) - 0.000090537) / (color * (0.983729 * color + 0.4329510) + 0.238081);
 return clamp(output_matrix * color, vec3(0.0), vec3(1.0));
}
void fragment() {
 vec2 material_uv = UV * uv_scale.xy + uv_offset.xy;
 vec4 texel = texture(color_map, material_uv);
 material_base=OUTPUT_IS_SRGB ? to_linear(base_color.rgb)*to_linear(texel.rgb) : base_color.rgb*texel.rgb;
 if(vertex_color) material_base*=COLOR.rgb;
 ALBEDO=OUTPUT_IS_SRGB ? compatibility_input(material_base) : material_base;
 vec3 derivatives = max(abs(dFdx(NORMAL)),abs(dFdy(NORMAL)));
 geometry_roughness = max(max(derivatives.x,derivatives.y),derivatives.z);
 coat_normal = NORMAL;
 material_sheen = (OUTPUT_IS_SRGB ? to_linear(sheen_color) : sheen_color) * sheen;
 ROUGHNESS = min(max(rough * dot(texture(roughness_map, material_uv),roughness_channel),0.0525)+geometry_roughness,1.0);
 METALLIC = metal * dot(texture(metallic_map, material_uv),metallic_channel);
 if (has_normal) { NORMAL_MAP = texture(normal_map,material_uv).rgb; NORMAL_MAP_DEPTH = normal_strength; }
 vec3 emission_texel = emission_has_map ? texture(emission_map,material_uv).rgb : vec3(emission_multiply ? 1.0 : 0.0);
 vec3 emission_color = OUTPUT_IS_SRGB ? to_linear(glow) : glow;
 if (OUTPUT_IS_SRGB) emission_texel = to_linear(emission_texel);
 material_glow = (emission_multiply ? emission_color*emission_texel : emission_color+emission_texel)*emission_energy;
 material_ao = dot(texture(occlusion_map,occlusion_uv2?UV2:material_uv),occlusion_channel);
 // TRANSMISSION_FRAGMENT
 // ALPHA_OUTPUT
 // UNLIT_OUTPUT
}
#include "res://game/render/three_cube_uv.gdshaderinc"
vec3 multiple_scatter(vec3 f0, float f90, vec2 dfg) {
 vec3 single = f0*dfg.x+f90*dfg.y;
 float ems = 1.0-dfg.x-dfg.y;
 vec3 average = f0+(1.0-f0)*0.047619;
 return single*average/(1.0-ems*average)*ems;
}
vec3 direct_brdf(vec3 n, vec3 l, vec3 vdir, vec3 f0, float f90, vec3 diffuse, float r) {
 float nl = max(dot(n,l),0.0);
 float nv = max(dot(n,vdir),0.0);
 vec3 h = normalize(l+vdir);
 float nh = max(dot(n,h),0.0);
 float vh = max(dot(vdir,h),0.0);
 float a2 = pow(r,4.0);
 float vis = 0.5/max(nl*sqrt(a2+(1.0-a2)*nv*nv)+nv*sqrt(a2+(1.0-a2)*nl*nl),0.000001);
 float denominator = nh*nh*(a2-1.0)+1.0;
 float distribution = a2/(PI*denominator*denominator);
 vec3 f = (f90-f0)*exp2((-5.55473*vh-6.98316)*vh)+f0;
 vec2 dv = texture(dfg_lut,vec2(r,nv)).rg;
 vec2 dl = texture(dfg_lut,vec2(r,nl)).rg;
 float ems = (1.0-dv.x-dv.y)*(1.0-dl.x-dl.y);
 vec3 avg = f0+(1.0-f0)*0.047619;
 vec3 multi = (f0*dv.x+f90*dv.y)*(f0*dl.x+f90*dl.y)*avg/(1.0-ems*avg+0.000001)*ems;
 return (diffuse+f*vis*distribution+multi)*nl;
}

float sheen_albedo(float nv) {
 float r2=sheen_rough*sheen_rough;
 float inverse=1.0/(sheen_rough+0.1);
 float a=-1.9362+1.0678*sheen_rough+0.4573*r2-0.8469*inverse;
 float b=-0.6014+0.5538*sheen_rough-0.4670*r2-0.1255*inverse;
 return clamp(exp(a*nv+b),0.0,1.0);
}
float sheen_compensation(float nv) { return 1.0-max(max(material_sheen.r,material_sheen.g),material_sheen.b)*sheen_albedo(nv); }
vec3 sheen_brdf(vec3 n,vec3 l,vec3 v) {
 float nl=max(dot(n,l),0.0), nv=max(dot(n,v),0.0), nh=max(dot(n,normalize(l+v)),0.0);
 float inv_alpha=1.0/(sheen_rough*sheen_rough);
 float d=(2.0+inv_alpha)*pow(max(1.0-nh*nh,0.0078125),inv_alpha*0.5)/(2.0*PI);
 float visibility=clamp(1.0/max(4.0*(nl+nv-nl*nv),0.000001),0.0,1.0);
 return material_sheen*d*visibility*nl;
}
vec3 coat_brdf(vec3 n,vec3 l,vec3 v,float r) {
 float nl=max(dot(n,l),0.0), nv=max(dot(n,v),0.0), nh=max(dot(n,normalize(l+v)),0.0), vh=max(dot(v,normalize(l+v)),0.0);
 float a2=pow(r,4.0);
 float visibility=0.5/max(nl*sqrt(a2+(1.0-a2)*nv*nv)+nv*sqrt(a2+(1.0-a2)*nl*nl),0.000001);
 float d=a2/(PI*pow(nh*nh*(a2-1.0)+1.0,2.0));
 return vec3(0.04+0.96*exp2((-5.55473*vh-6.98316)*vh))*visibility*d*nl;
}
void light() {
 if (LIGHT_IS_DIRECTIONAL) {
  float nl = max(dot(NORMAL, LIGHT),0.0);
  float nv = max(dot(NORMAL, VIEW),0.0);
  float surface_roughness = ROUGHNESS;
  float surface_metal = METALLIC;
  vec3 f0 = mix(vec3(0.04*specular_intensity),ALBEDO,surface_metal);
  float f90 = mix(specular_intensity,1.0,surface_metal);
  float coat_r = min(max(coat_rough,0.0525)+geometry_roughness,1.0);
  vec3 direction = normalize(vec3(8.0,13.0,7.0));
  vec3 right = normalize(cross(vec3(0.0,1.0,0.0),direction));
  vec3 up = cross(direction,right);
  float shadow = receive_shadows && (studio || (abs(dot(world_position,right)) <= 5.0 && abs(dot(world_position,up)) <= 5.0)) ? ATTENUATION : 1.0;
  vec2 dfg_v = texture(dfg_lut, vec2(surface_roughness,nv)).rg;
  vec3 diffuse = ALBEDO * (1.0-surface_metal) / PI * (1.0-transmission_amount);
  vec3 radiance = diffuse * (studio ? studio_ambient : market_ambient) * material_ao * sheen_compensation(nv) + material_glow;
  float direct_comp = min(sheen_compensation(nv),sheen_compensation(nl));
  radiance += (direct_brdf(NORMAL,LIGHT,VIEW,f0,f90,diffuse,surface_roughness)*direct_comp+sheen_brdf(NORMAL,LIGHT,VIEW))*LIGHT_COLOR*shadow;
  vec3 coat_radiance = coat_brdf(coat_normal,LIGHT,VIEW,coat_r)*LIGHT_COLOR*shadow;
  // The complete linear-light sum is mapped once, as in Three. Specular output
  // avoids Godot's additional automatic albedo/metallic multiplication.
  for (int i=0; i<32; i++) {
   if (studio || i>=market_light_count) break;
   vec4 point = texelFetch(market_light_data,ivec2(i,0),0);
   vec4 color_energy = texelFetch(market_light_data,ivec2(i,1),0);
   float decay = texelFetch(market_light_data,ivec2(i,2),0).r;
   vec3 relative = point.xyz-world_position;
   float distance = length(relative);
   float attenuation = 1.0/max(pow(distance,decay),0.01);
   if (point.w>0.0) attenuation *= pow(clamp(1.0-pow(distance/point.w,4.0),0.0,1.0),2.0);
   if (attenuation>0.0) {
    vec3 l=normalize(mat3(VIEW_MATRIX)*relative);
    float comp=min(sheen_compensation(nv),sheen_compensation(max(dot(NORMAL,l),0.0)));
    radiance += (direct_brdf(NORMAL,l,VIEW,f0,f90,diffuse,surface_roughness)*comp+sheen_brdf(NORMAL,l,VIEW))*color_energy.rgb*color_energy.a*attenuation;
    coat_radiance += coat_brdf(coat_normal,l,VIEW,coat_r)*color_energy.rgb*color_energy.a*attenuation;
   }
  }
  vec3 world_normal = normalize(mat3(INV_VIEW_MATRIX)*NORMAL);
  vec3 reflect_dir = normalize(mix(reflect(-VIEW,NORMAL),NORMAL,pow(surface_roughness,4.0)));
  reflect_dir = normalize(mat3(INV_VIEW_MATRIX)*reflect_dir);
  vec3 env_diffuse = textureCubeUV(environment_map,world_normal,1.0).rgb*environment_intensity;
  vec3 env_radiance = textureCubeUV(environment_map,reflect_dir,surface_roughness).rgb*environment_intensity;
  vec3 single_dielectric = specular_intensity*(vec3(0.04)*dfg_v.x+dfg_v.y);
  vec3 single_metallic = ALBEDO*dfg_v.x+dfg_v.y;
  vec3 multi_dielectric = multiple_scatter(vec3(0.04*specular_intensity),specular_intensity,dfg_v);
  vec3 multi_metallic = multiple_scatter(ALBEDO,1.0,dfg_v);
  float specular_occlusion = clamp(pow(nv+material_ao,exp2(-16.0*surface_roughness-1.0))-1.0+material_ao,0.0,1.0);
  radiance += (env_radiance*mix(single_dielectric,single_metallic,surface_metal)+env_diffuse*mix(multi_dielectric,multi_metallic,surface_metal))*specular_occlusion*sheen_compensation(nv);
  radiance += env_diffuse*ALBEDO*(1.0-surface_metal)*(1.0-transmission_amount)*(1.0-single_dielectric-multi_dielectric)*material_ao*sheen_compensation(nv);
  radiance += env_diffuse*material_sheen*sheen_albedo(nv)*material_ao;
  // TRANSMISSION_LIGHT
  if (coat>0.0) {
   float coat_nv=max(dot(coat_normal,VIEW),0.0);
   vec3 reflection=normalize(mix(reflect(-VIEW,coat_normal),coat_normal,pow(coat_r,4.0)));
   reflection=normalize(mat3(INV_VIEW_MATRIX)*reflection);
   vec2 coat_dfg=texture(dfg_lut,vec2(coat_r,coat_nv)).rg;
   coat_radiance += textureCubeUV(environment_map,reflection,coat_r).rgb*environment_intensity*(0.04*coat_dfg.x+coat_dfg.y);
   float coat_f=0.04+0.96*exp2((-5.55473*coat_nv-6.98316)*coat_nv);
   radiance=radiance*(1.0-coat*coat_f)+coat*coat_radiance;
  }
  vec3 output_color = unlit ? ALBEDO : radiance;
  if (mapped_tone && linear_pass < 0.5) output_color = aces(output_color);
  if (use_fog && !studio) {
   float factor=smoothstep(186.0,315.0,fog_depth);
   if(linear_pass>0.5) output_color=mix(output_color,OUTPUT_IS_SRGB ? to_linear(market_fog.rgb) : market_fog.rgb,factor);
   else output_color=to_linear(mix(to_srgb(output_color),OUTPUT_IS_SRGB ? market_fog.rgb : to_srgb(market_fog.rgb),factor));
  }
  SPECULAR_LIGHT += OUTPUT_IS_SRGB ? compatibility_output(linear_pass>0.5?output_color:to_srgb(output_color)) : output_color;
 }
}
