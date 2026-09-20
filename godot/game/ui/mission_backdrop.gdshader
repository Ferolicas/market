shader_type canvas_item;
uniform sampler2D screen_texture : hint_screen_texture, filter_linear_mipmap;
void fragment() {
 vec3 background = textureLod(screen_texture, SCREEN_UV, 3.3).rgb;
 COLOR = vec4(mix(background, vec3(0.02745098,0.10588235,0.08235294),0.65882353),COLOR.a);
}
