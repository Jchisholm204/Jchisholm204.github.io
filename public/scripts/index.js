/**
 * @author Jacob Chisholm
 * 
 */

function windowResize(){
    const platform = navigator.userAgent;
    let deviceType = "desktop";

    if (/(tablet|ipad|playbook|silk)|(android(?!.*mobi))/i.test(platform)) {
        deviceType = "tablet";
    }
    else if (/Mobile|Android|iP(hone|od)|IEMobile|BlackBerry|Kindle|Silk-Accelerated|(hpw|web)OS|Opera M(obi|ini)/.test(platform)) {
        deviceType = "mobile";
    }

    const sidebar = document.getElementById("sidebar");
    const content = document.getElementById("page-content");
    const header = document.getElementById("header");
    const copyright = document.getElementById("copyright");
    //const article = document.getElementsByName("article");

    if(window.innerWidth < 900 || deviceType === "mobile"){
        sidebar.style.display = 'none';
        sidebar.style.visibility = 'hidden'

        header.style.display = 'flex';
        header.style.visibility = 'visible';

        content.style.marginLeft = '5px';
        copyright.style.paddingLeft = '0px';
    }
    else{
        sidebar.style.display = 'flex';
        sidebar.style.visibility = 'visible'

        header.style.display = 'none';
        header.style.visibility = 'hidden';

        content.style.marginLeft = '245px';
        copyright.style.paddingLeft = '240px';
    }
}

window.onload = () => {
    windowResize();
}

window.addEventListener("resize", windowResize, true)