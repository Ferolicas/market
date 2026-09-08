using System.Collections;
using MiniMarket.Core;
using MiniMarket.Data;
using MiniMarket.Interactions;
using MiniMarket.Performance;
using MiniMarket.Player;
using Newtonsoft.Json.Linq;
using NUnit.Framework;
using UnityEngine;
using UnityEngine.TestTools;

namespace MiniMarket.PlayModeTests
{
    public sealed class RuntimeSmokeTests
    {
        [UnityTest]
        public IEnumerator AutomaticStationActivatesOnlyOnceUntilPlayerLeaves()
        {
            var playerObject=new GameObject("SingleEntryPlayer");playerObject.AddComponent<CharacterController>();
            var player=playerObject.AddComponent<PlayerController>();player.Bind(State());
            var directorObject=new GameObject("SingleEntryDirector");var director=directorObject.AddComponent<InteractionDirector>();director.Bind(player);
            var pointObject=new GameObject("SingleEntryPoint");pointObject.AddComponent<SphereCollider>();
            var point=pointObject.AddComponent<InteractionPoint>();point.Configure("farm:test","Cosechar",3f,true,0,.05f);point.repeatAutomatically=false;
            var activations=0;point.Activated+=_=>activations++;director.Register(point);

            yield return null;yield return null;yield return null;
            Assert.That(activations,Is.EqualTo(1));
            playerObject.transform.position=Vector3.right*10f;yield return null;
            playerObject.transform.position=Vector3.zero;yield return null;yield return null;
            Assert.That(activations,Is.EqualTo(2));

            Object.Destroy(playerObject);Object.Destroy(directorObject);Object.Destroy(pointObject);
        }

        [UnityTest]
        public IEnumerator PerformanceGovernorSelectsAValidTierAndFrameTarget()
        {
            var gameObject=new GameObject("PerformanceGovernorTest");
            var governor=gameObject.AddComponent<PerformanceGovernor>();
            yield return null;

            Assert.That(System.Enum.IsDefined(typeof(DevicePerformanceTier),governor.ActiveTier),Is.True);
            Assert.That(new[]{30,60},Does.Contain(Application.targetFrameRate));
            Object.Destroy(gameObject);
        }

        [UnityTest]
        public IEnumerator PlayerRedirectsMovementAndFacingOnTheFirstFrameOfANewDirection()
        {
            var gameObject=new GameObject("PlayerImmediateTurnTest");
            gameObject.AddComponent<CharacterController>();
            var player=gameObject.AddComponent<PlayerController>();
            player.Bind(State());
            player.VirtualInput=Vector2.right;
            yield return null;
            var firstDirection=gameObject.transform.forward;

            player.VirtualInput=Vector2.left;
            yield return null;
            var redirected=gameObject.transform.forward;

            Assert.That(Vector3.Dot(firstDirection,redirected),Is.LessThan(-.95f),"El cuerpo debe girar en el primer frame, sin patinar con la dirección anterior");
            Object.Destroy(gameObject);
        }

        static GameStateDocument State()
        {
            var franchise=new JObject
            {
                ["id"]="barrio",
                ["playerSpeedTier"]=1,
                ["carry"]=new JObject { ["capacity"]=3,["items"]=new JObject() },
            };
            return new GameStateDocument(new JObject
            {
                ["revision"]=0,
                ["currentFranchiseId"]="barrio",
                ["franchises"]=new JArray(franchise),
            },new GameSignals());
        }
    }
}
