shader_type spatial;
render_mode ambient_light_disabled;
uniform vec4 base_color : source_color = vec4(1.0);
uniform sampler2D color_map : source_color, hint_default_white;
uniform sampler2D dfg_lut : filter_linear, repeat_disable;
uniform sampler2D environment_map : filter_linear, repeat_disable;
uniform float rough = 1.0;
uniform float metal = 0.0;
uniform bool vertex_color = false;
uniform bool unlit = false;
uniform vec3 glow : source_color = vec3(0.0);
uniform float ambient = 1.15;
varying vec3 world_position;
void vertex() { world_position = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz; }
vec3 to_linear(vec3 c) { return mix(pow((c+0.055)/1.055,vec3(2.4)),c/12.92,lessThan(c,vec3(0.04045))); }
vec3 to_srgb(vec3 c) { return mix(1.055*pow(max(c,vec3(0.0)),vec3(1.0/2.4))-0.055,c*12.92,lessThan(c,vec3(0.0031308))); }
void fragment() {
 ALBEDO = base_color.rgb * texture(color_map, UV).rgb;
 if (vertex_color) ALBEDO = OUTPUT_IS_SRGB ? to_srgb(to_linear(ALBEDO) * COLOR.rgb) : ALBEDO * COLOR.rgb;
 ROUGHNESS = rough;
 METALLIC = metal;
}
vec3 aces(vec3 color) {
 mat3 input_matrix = mat3(vec3(0.59719,0.07600,0.02840),vec3(0.35458,0.90834,0.13383),vec3(0.04823,0.01566,0.83777));
 mat3 output_matrix = mat3(vec3(1.60475,-0.10208,-0.00327),vec3(-0.53108,1.10813,-0.07276),vec3(-0.07367,-0.00605,1.07602));
 color = input_matrix * (color / 0.6);
 color = (color * (color + 0.0245786) - 0.000090537) / (color * (0.983729 * color + 0.4329510) + 0.238081);
 return clamp(output_matrix * color, vec3(0.0), vec3(1.0));
}
#include "res://tools/lighting/cube_uv.gdshaderinc"
vec3 multiple_scatter(vec3 f0, vec2 dfg) {
 vec3 single = f0*dfg.x+dfg.y;
 float ems = 1.0-dfg.x-dfg.y;
 vec3 average = f0+(1.0-f0)*0.047619;
 return single*average/(1.0-ems*average)*ems;
}
void light() {
 if (LIGHT_IS_DIRECTIONAL) {
  float nl = max(dot(NORMAL, LIGHT),0.0);
  float nv = max(dot(NORMAL, VIEW),0.0);
  vec3 half_dir = normalize(LIGHT + VIEW);
  float nh = max(dot(NORMAL, half_dir),0.0);
  float vh = max(dot(VIEW, half_dir),0.0);
  float a2 = pow(max(rough,0.0525),4.0);
  float v = 0.5 / max(nl * sqrt(a2 + (1.0-a2)*nv*nv) + nv * sqrt(a2 + (1.0-a2)*nl*nl),0.000001);
  float denominator = nh*nh*(a2-1.0)+1.0;
  float d = (1.0/PI)*a2/(denominator*denominator);
  vec3 f0 = mix(vec3(0.04),ALBEDO,metal);
  float fresnel = exp2((-5.55473*vh-6.98316)*vh);
  vec3 f = (1.0-f0)*fresnel+f0;
  vec3 direction = normalize(vec3(8.0,13.0,7.0));
  vec3 right = normalize(cross(vec3(0.0,1.0,0.0),direction));
  vec3 up = cross(direction,right);
  float shadow = abs(dot(world_position,right)) <= 5.0 && abs(dot(world_position,up)) <= 5.0 ? ATTENUATION : 1.0;
  vec2 dfg_v = texture(dfg_lut, vec2(rough,nv)).rg;
  vec2 dfg_l = texture(dfg_lut, vec2(rough,nl)).rg;
  vec3 fss_v = f0*dfg_v.x+dfg_v.y;
  vec3 fss_l = f0*dfg_l.x+dfg_l.y;
  float ems = (1.0-dfg_v.x-dfg_v.y)*(1.0-dfg_l.x-dfg_l.y);
  vec3 favg = f0+(1.0-f0)*0.047619;
  vec3 multi = fss_v*fss_l*favg/(1.0-ems*favg+0.000001)*ems;
  vec3 diffuse = ALBEDO * (1.0-metal) / PI;
  vec3 radiance = diffuse * ambient + (diffuse + f*v*d + multi) * (to_linear(vec3(1.0, 246.0/255.0, 223.0/255.0)) * 2.3) * nl * shadow + glow;
  // The complete linear-light sum is mapped once, as in Three. Specular output
  // avoids Godot's additional automatic albedo/metallic multiplication.
  vec3 world_normal = normalize(mat3(INV_VIEW_MATRIX)*NORMAL);
  vec3 reflect_dir = normalize(mix(reflect(-VIEW,NORMAL),NORMAL,pow(rough,4.0)));
  reflect_dir = normalize(mat3(INV_VIEW_MATRIX)*reflect_dir);
  vec3 env_diffuse = textureCubeUV(environment_map,world_normal,1.0).rgb*0.28;
  vec3 env_radiance = textureCubeUV(environment_map,reflect_dir,rough).rgb*0.28;
  vec3 single_dielectric = vec3(0.04)*dfg_v.x+dfg_v.y;
  vec3 single_metallic = ALBEDO*dfg_v.x+dfg_v.y;
  vec3 multi_dielectric = multiple_scatter(vec3(0.04),dfg_v);
  vec3 multi_metallic = multiple_scatter(ALBEDO,dfg_v);
  radiance += env_radiance*mix(single_dielectric,single_metallic,metal);
  radiance += env_diffuse*(mix(multi_dielectric,multi_metallic,metal)+ALBEDO*(1.0-metal)*(1.0-single_dielectric-multi_dielectric));
  SPECULAR_LIGHT += aces(unlit ? ALBEDO : radiance);
 }
}
