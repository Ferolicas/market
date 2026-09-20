shader_type canvas_item;
render_mode blend_premul_alpha;
// Mobile requires RGBA16F for accurate alpha. Its texture is linear; encode
// straight colour before restoring premultiplication for the SDR UI canvas.
vec3 to_srgb(vec3 value) {
 return mix(1.055*pow(max(value,vec3(0.0)),vec3(1.0/2.4))-0.055,value*12.92,lessThan(value,vec3(0.0031308)));
}
void fragment() {
 vec4 value=texture(TEXTURE,UV);
 COLOR=vec4(value.a>0.00001?to_srgb(value.rgb/value.a)*value.a:vec3(0.0),value.a);
}
