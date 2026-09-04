using UnityEngine;

namespace MiniMarket.Audio
{
    public sealed class AudioManager : MonoBehaviour
    {
        AudioSource ui; AudioSource ambience; AudioClip confirm; bool started;
        public void Build()
        {
            ui=gameObject.AddComponent<AudioSource>();ui.volume=.18f;ui.playOnAwake=false;
            ambience=gameObject.AddComponent<AudioSource>();ambience.volume=.045f;ambience.loop=true;ambience.playOnAwake=false;ambience.clip=Tone("StoreAmbience",88,.5f);
            confirm=Tone("Confirm",720,.075f);
        }
        public void UiConfirm(){if(!started){started=true;if(ambience)ambience.Play();}if(ui&&confirm)ui.PlayOneShot(confirm,.55f);}
        static AudioClip Tone(string name,float frequency,float seconds)
        {
            const int rate=22050;var count=Mathf.CeilToInt(rate*seconds);var samples=new float[count];
            for(var i=0;i<count;i++){var envelope=Mathf.Min(1,i/80f)*Mathf.Min(1,(count-i)/160f);samples[i]=Mathf.Sin(2*Mathf.PI*frequency*i/rate)*.12f*envelope;}
            var clip=AudioClip.Create(name,count,1,rate,false);clip.SetData(samples,0);return clip;
        }
        void OnDestroy(){if(confirm)Destroy(confirm);if(ambience&&ambience.clip)Destroy(ambience.clip);}
    }
}
