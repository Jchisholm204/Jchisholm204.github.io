---
title: Linux "dotfiles" Setup
date: 2024-12-1
categories: [Linux]
tags: [Automation, Linux]
author: Jacob
image:
  path: /assets/linux/dotfiles.jpg
  alt: Linux Dotfiles
---

Over the past few months I have been experimenting more and more with running Linux as a daily driver on my laptop. This article explores writing a bash script for some basic OS configuration.

# Linux and Dotfiles
Over the summer, I started my Linux journey with Arch Linux.
Using the [M4W](https://github.com/mylinuxforwork/dotfiles) dotfiles, I was able to quickly and easily get the full configuration up in no time.
When school started, I switched to Fedora, then NixOS, then back to Fedora.
The more I switched while trying to find the right distribution, the more time I spent setting up my home configuration.

## What is a Home Configuration?
Depending on who you ask, a home configuration could be anything from the entirety of the setup to simply how you style a terminal.
For me, a home configuration is how my terminal looks and feels.
This includes setting up ZSH with starship, TMUX, Git, and Neovim.

## What are Dotfiles?
Dotfiles is a common name referring to application configuration files.
For Alacritty (my terminal of choice), this involves a `.toml` file placed in `~/.config/alacritty`.
For TMUX, a `.conf` file must be placed in `~/`.
For Neovim, a series of lua files must be placed in `~/.config/nvim`.
The list goes on for several other applications including:
- Alacritty
- Fonts
- TMUX
- Neovim
- Git
- ZSH
	- Starship
	- Autosuggestions

For each of the aforementioned applications, the corresponding dotfiles must be placed in their respective locations.
When doing this for the first time, it can be a bit daunting.
But when doing this for the 31st time, it can be quite annoying.
Therefore, I decided to automate the process.

# Automatic Installation 
After installing my dotfiles on multiple computers multiple times, I figured that there had to be a better way.
So, I created my own bash script to automate this installation.
While improvements could be made, this was my first attempt at writing a bash script.
Although I am very familiar to working in a terminal, the scripting syntax is a bit different.
Currently, I have tested the script to work on Fedora, Ubuntu and NixOS.
I also added functionality for Arch Linux if I ever decide to go back.

## The Script
First, the script grabs the distribution release name and prompts the user to initialise the repository sub modules.
All of my dotfiles are contained within a single monolithic repository.
However, it is a collection of smaller repositories for each application.
The release name is necessary for determining which package manager to use in the install function.
The install function is used to determine which install command to run when attempting to install a new package.


```bash
#!/bin/bash
# Dotfiles Install Script
# Jchisholm204.github.io

# Get the distro ID (for apt install)
distro_id=$(cat /etc/*release | grep "^ID=" | cut -d'=' -f2)

echo "Installing JC204 Config"
C_DIR=$(pwd)
echo "Installing from $C_DIR"

echo "Have git submodules been initialized? [y/n]"
read -r ans
if [ "$ans" == "n" ]; then
    echo "Git submodules must be initialized..Doing it now"
    git submodule init
    git submodule update
fi

# Install Function (for different distros)
install() {
    if [ $1 == "" ]; then
        return 1
    fi
    echo "Installing $1 for $distro_id"
    if [ "$distro_id" = "fedora" ]; then
        sudo dnf install $1
    elif [ "$distro_id" = "ubuntu" ]; then
        sudo apt-get install $1
    elif [ "$distro_id" = "archlinux" ]; then
        pacman -S $1
    fi
    return 0
}
```


The next section of the script runs through every application, prompting the user as it adds symlinks to the expected location for the configuration files that point back to the main repository.
At every stage, the script asks the user if they have previously installed configuration files and prompts the user if they would like to backup or delete old files.


```bash
echo "Setting up Fonts"

FONT_DIR="$HOME/.local/share/fonts"

if [ ! -d "$FONT_DIR" ]; then
    mkdir "$FONT_DIR"
    echo "Created $FONT_DIR"
else
    echo "Skipping Font Directory Creation Already Exists"
fi

echo -n "Install Fonts [y/n]:"
read -r ans

if [ "$ans" == "y" ]; then
    for FDIR in "$C_DIR"/fonts/*; do
        [ -d "$FDIR" ] || continue;
        echo "Copying Font: $(basename "$FDIR")"
        cp "$FDIR"/* $FONT_DIR
    done
fi

echo "Installed Fonts"

echo "Install Alacritty? [y/n]"
read -r ans
if [ "$ans" == "y" ]; then
    install "alacritty"
    if [ ! -d "$HOME/.config/alacritty" ]; then
        echo "Found an old Alacritty Config"
        echo "Would you like to backup? [y/n]"
        read -r ans
        if [ "$ans" == "y" ]; then
            mv "$HOME/.config/alacritty" "$HOME/.config/alacritty.bak"
        else
            rm -r "$HOME/.config/alacritty"
        fi
    fi
    ln -s $(pwd)/alacritty "$HOME/.config/"
fi


echo "Set up ZSH? [y/n]:"
read -r ans
if [ "$ans" == "y" ]; then
    install "zsh"
    echo "Install OhMyZsh? [y/n]"
    read -r ans
    if [ "$ans" == "y" ]; then
        sh -c "$(curl -fsSL https://raw.githubusercontent.com/ohmyzsh/ohmyzsh/master/tools/install.sh)"
        echo "Cloning zsh-autosuggestions"
        git clone https://github.com/zsh-users/zsh-autosuggestions ${ZSH_CUSTOM:-~/.oh-my-zsh/custom}/plugins/zsh-autosuggestions
    fi
    if [ ! -d  "$HOME/.zshrc" ]; then
        echo "Found OLD ZSH Config: renamed to zshrc.bak"
        mv "$HOME"/.zshrc "$HOME"/zshrc.bak
    fi
    ln -s $(pwd)/.zshrc "$HOME"
    echo "Created ZSHrc Symlink"
fi

echo "Set up TMUX [y/n]"
read -r ans
if [ "$ans" == "y" ]; then
    if [ ! $(ls /bin | grep tmux) == "tmux"]; then
        echo "Attempting to install tmux"
        install "tmux"
    else
        echo "TMUX Installation Found"
    fi
    echo "Looking for old TMUX Config"
    if [ ! -d "$HOME/.tmux.conf" ]; then
        echo "Found an old TMUX Config"
        echo "Would you like to backup? [y/n]"
        read -r ans
        if [ "$ans" == "y" ]; then
            mv "$HOME/.tmux.conf" "$HOME/tmux.conf.bak"
        else
            rm "$HOME/.tmux.conf"
        fi
    fi
    ln -s $(pwd)/tmux/tmux.conf $HOME/.tmux.conf
    tmux source $HOME/.tmux.conf
fi

echo "Set up Git? [y/n]"
read -r ans
if [ "$ans" == "y" ]; then
    echo "Looking for old Git Config"
    if [ ! -d "$HOME/.gitconfig" ]; then
        echo "Found an old Git Config"
        echo "Would you like to backup? [y/n]"
        read -r ans
        if [ "$ans" == "y" ]; then
            mv "$HOME/.gitconfig" "$HOME/.gitconfig.bak"
        else
            rm "$HOME/.gitconfig"
        fi
    fi
    ln -s "$(pwd)/git/.gitconfig" "$HOME/.gitconfig"
fi

echo "Install Completed."
```

# Conclusion
Overall, there really isn't a lot to it.
However, I learned a lot from this experience that I will be able to apply to future Linux projects.
This script has already been used twice and will hopefully be used many more times as I continue to try new releases on new machines.