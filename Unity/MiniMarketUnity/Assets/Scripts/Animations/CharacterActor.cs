using System;
using System.Collections.Generic;
using UnityEngine;

namespace MiniMarket.Animations
{
    public sealed class CharacterActor : MonoBehaviour
    {
        static readonly string[] BlinkShapes = { "Blink_L", "Blink_R" };
        Animation[] legacyAnimations = Array.Empty<Animation>();
        readonly Dictionary<string, string> clips = new(StringComparer.OrdinalIgnoreCase);
        SkinnedMeshRenderer[] faces;
        float nextBlink;
        float nextBoundsCheck;
        float blinkTime;
        string current;
        float currentRate = 1f;

        public int AnimationCount => clips.Count;
        public int BlendShapeCount { get; private set; }

        public void Bind(Transform animationRoot = null)
        {
            legacyAnimations = (animationRoot ? animationRoot : transform).GetComponentsInChildren<Animation>(true);
            clips.Clear();
            foreach (var animation in legacyAnimations)
                foreach (AnimationState clip in animation)
                {
                    // Nothing set a wrap mode, so a clip could stop dead at its
                    // last frame instead of carrying on. Every motion here is a
                    // cycle or a gesture that reads fine repeated.
                    clip.wrapMode = WrapMode.Loop;
                    if (!clips.ContainsKey(clip.name)) clips[clip.name] = clip.name;
                }
            faces = GetComponentsInChildren<SkinnedMeshRenderer>(true);
            var names = new HashSet<string>();
            foreach (var face in faces)
                for (var i = 0; i < face.sharedMesh.blendShapeCount; i++) names.Add(face.sharedMesh.GetBlendShapeName(i));
            BlendShapeCount = names.Count;
            foreach (var face in faces)
            {
                if (!face.sharedMesh || face.sharedMesh.blendShapeCount == 0) continue;
                var frames = face.sharedMesh.GetBlendShapeFrameCount(0);
                Debug.Log($"MINIMARKET_MORPHSCALE mesh={face.name} shapes={face.sharedMesh.blendShapeCount} frames={frames} frameWeight={face.sharedMesh.GetBlendShapeFrameWeight(0, frames - 1):0.###}");
                break;
            }
            nextBlink = Time.time + UnityEngine.Random.Range(2f, 5f);
        }

        /// How far each locomotion clip carries itself per second, in world
        /// units at the presentation scale. Measured off the delivered files:
        /// the run covers 1.978 m in 0.633 s, the walk 0.974 m in 1.017 s.
        /// Without these the legs cycle at the pace they were authored for
        /// while the controller carries the body three times faster, which is
        /// the character taking one stride and sliding several metres.
        public const float RunGroundSpeed = 12.18f;
        public const float WalkGroundSpeed = 3.74f;
        public const float CarryWalkGroundSpeed = 2.45f;
        /// Those three were measured with the cast presented at 3.90. A body
        /// twice that size carries its own stride twice as far per cycle, so
        /// every speed above is read against the scale the actor is drawn at;
        /// without this the legs cycled 44% too fast and the feet skated.
        public const float MeasuredScale = 3.90f;
        public float StrideScale => transform.localScale.x / MeasuredScale;

        /// The clip whose own pace is nearest, and the rate that matches it.
        public static (string clip, float rate) Locomotion(float worldSpeed, bool carrying, float strideScale = 1f)
        {
            var walkPace = WalkGroundSpeed * strideScale;
            var runPace = RunGroundSpeed * strideScale;
            var carryPace = CarryWalkGroundSpeed * strideScale;
            // The carry walk is a slow clip; past this it cannot cover the
            // ground and the body would slide, so the run takes over and the
            // hands keep their grip on the basket.
            if (carrying && worldSpeed <= carryPace * 2.6f)
                return ("CarryWalk", Mathf.Clamp(worldSpeed / carryPace, .55f, 2.6f));
            // Halfway between the two clips' own speeds: below it the walk is
            // the closer match, above it the run is.
            var crossover = (walkPace + runPace) * .5f;
            return worldSpeed >= crossover
                ? ("Run", Mathf.Clamp(worldSpeed / runPace, .6f, 2.2f))
                : ("Walk", Mathf.Clamp(worldSpeed / walkPace, .55f, 2.4f));
        }

        public bool Play(string requested, float fade = .18f, float rate = 1f)
        {
            if (legacyAnimations.Length == 0) return false;
            if (current == requested && Mathf.Approximately(currentRate, rate)) return false;
            var resolved = Resolve(requested);
            if (resolved == null && requested == "Run")
            {
                // Every character carries a Run; this stands in only for one
                // that somehow does not, so a sprint never freezes mid-stride.
                resolved = Resolve("Walk");
                rate *= RunGroundSpeed / WalkGroundSpeed;
            }
            if (resolved == null) return false;
            var played = false;
            var repeat = current == requested;
            foreach (var animation in legacyAnimations)
            {
                var clip = animation.GetClip(resolved);
                if (clip == null) continue;
                var state = animation[resolved];
                if (state != null) state.speed = rate;
                // Re-issuing a crossfade for a rate change would restart the
                // blend every frame the speed drifts, which reads as a stutter.
                if (!repeat) animation.CrossFade(resolved, fade);
                played = true;
            }
            if (!played) return false;
            current = requested; currentRate = rate;
            return true;
        }

        string Resolve(string requested)
        {
            if (clips.ContainsKey(requested)) return requested;
            foreach (var key in clips.Keys)
                if (key.EndsWith(requested, StringComparison.OrdinalIgnoreCase) || key.Contains(requested, StringComparison.OrdinalIgnoreCase)) return key;
            return null;
        }

        /// A skinned character is about 2.4 units tall. Anything much larger means
        /// vertices have been flung away from the body, which is what the reported
        /// flat shard looks like. Naming the actor and the size turns an
        /// intermittent visual glitch into a log line.
        void WatchForBurst()
        {
            if (Time.time < nextBoundsCheck) return;
            nextBoundsCheck = Time.time + .1f;
            foreach (var face in faces)
            {
                if (!face || !face.enabled) continue;
                var size = face.bounds.size;
                var longest = Mathf.Max(size.x, Mathf.Max(size.y, size.z));
                if (longest <= 3.2f) continue;
                Debug.Log($"MINIMARKET_BURST actor={name} mesh={face.name} clip={current} size={size.x:0.0},{size.y:0.0},{size.z:0.0} at={transform.position.x:0.0},{transform.position.z:0.0}");
            }
        }

        /// <summary>Weight is 0..100. glTF stores morph weights in 0..1, so the
        /// imported frame can be registered at 1 rather than Unity's usual 100;
        /// writing 100 into such a shape extrapolates it a hundredfold and tears
        /// the face into a spike. Rescale to whatever the importer used.</summary>
        public void SetExpression(string shape, float weight)
        {
            foreach (var renderer in faces)
            {
                var mesh = renderer.sharedMesh;
                if (!mesh) continue;
                var index = mesh.GetBlendShapeIndex(shape);
                if (index < 0) continue;
                var frames = mesh.GetBlendShapeFrameCount(index);
                var full = frames > 0 ? mesh.GetBlendShapeFrameWeight(index, frames - 1) : 100f;
                renderer.SetBlendShapeWeight(index, Mathf.Clamp01(weight / 100f) * full);
            }
        }

        public void ResetExpressions()
        {
            foreach(var renderer in faces)
                for(var i=0;i<renderer.sharedMesh.blendShapeCount;i++)renderer.SetBlendShapeWeight(i,0);
            blinkTime=0;nextBlink=Time.time+UnityEngine.Random.Range(2f,5f);
        }

        void Update()
        {
            WatchForBurst();
            if (Time.time >= nextBlink && blinkTime <= 0) blinkTime = .14f;
            if (blinkTime <= 0) return;
            blinkTime -= Time.deltaTime;
            var phase = 1f - Mathf.Abs(blinkTime / .14f * 2f - 1f);
            foreach (var blink in BlinkShapes) SetExpression(blink, phase * 100f);
            if (blinkTime <= 0) nextBlink = Time.time + UnityEngine.Random.Range(2.2f, 5.6f);
        }
    }
}
